import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ApiConfig } from '../config.js';
import type { MediaPutInput, MediaStore, ResolvedImage } from '@devday/application-ports';
export type { MediaPutInput, ResolvedImage } from '@devday/application-ports';

export interface MediaMetadata {
  id: string;
  studyId: string;
  segmentId: string | null;
  kind: 'image' | 'audio';
  storageKey: string;
  contentType: string;
}
export interface MediaMetadataRepository {
  insert(record: MediaMetadata): Promise<void>;
  findById(id: string): Promise<MediaMetadata | undefined>;
}
export class MediaNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  readonly statusCode = 404;
  constructor() {
    super('Image not found.');
    this.name = 'MediaNotFoundError';
  }
}

function recordFor(input: MediaPutInput): MediaMetadata {
  const allowed =
    input.kind === 'image'
      ? ['image/png', 'image/jpeg', 'image/webp']
      : ['audio/wav', 'audio/x-wav', 'audio/pcm'];
  if (!allowed.includes(input.contentType) || input.bytes.byteLength === 0) {
    throw new Error('Media requires non-empty bytes and a supported content type.');
  }
  if (!input.studyId || (input.kind === 'audio' && !input.segmentId)) {
    throw new Error('Media requires a study and audio requires a segment.');
  }
  const id = randomUUID();
  return {
    id,
    studyId: input.studyId,
    segmentId: input.segmentId ?? null,
    kind: input.kind,
    storageKey: `${input.kind}/${id}`,
    contentType: input.contentType,
  };
}

async function imageRecord(
  repository: MediaMetadataRepository,
  id: string,
): Promise<MediaMetadata> {
  const record = await repository.findById(id);
  // Audio is kept for server processing; it must never acquire a public URL.
  if (!record || record.kind !== 'image') throw new MediaNotFoundError();
  return record;
}

/** Actual persisted bytes. Metadata is stored by the application's PostgreSQL repository. */
export class LocalFilesystemMediaStore implements MediaStore {
  private readonly root: string;
  constructor(
    root: string,
    private readonly repository: MediaMetadataRepository,
  ) {
    if (!isAbsolute(root)) throw new Error('MEDIA_LOCAL_DIR must be absolute.');
    this.root = resolve(root);
  }

  private path(storageKey: string): string {
    const filename = resolve(this.root, storageKey);
    const key = relative(this.root, filename);
    if (!key || key === '..' || key.startsWith(`..${sep}`) || isAbsolute(key))
      throw new MediaNotFoundError();
    return filename;
  }

  async put(input: MediaPutInput): Promise<{ mediaId: string }> {
    const record = recordFor(input);
    const filename = this.path(record.storageKey);
    await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
    await writeFile(filename, input.bytes, { flag: 'wx', mode: 0o600 });
    try {
      await this.repository.insert(record);
    } catch (error) {
      await rm(filename, { force: true }).catch(() => undefined);
      throw error;
    }
    return { mediaId: record.id };
  }

  async resolveImage(id: string): Promise<ResolvedImage> {
    const record = await imageRecord(this.repository, id);
    try {
      return {
        kind: 'bytes',
        bytes: await readFile(this.path(record.storageKey)),
        contentType: record.contentType,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new MediaNotFoundError();
      throw error;
    }
  }
}

export interface S3MediaStoreOptions {
  bucket: string;
  region: string;
  repository: MediaMetadataRepository;
  client?: S3Client;
}

export class S3MediaStore implements MediaStore {
  private readonly client: S3Client;
  constructor(private readonly options: S3MediaStoreOptions) {
    if (!options.bucket || !options.region)
      throw new Error('MEDIA_BUCKET and AWS_REGION are required.');
    this.client = options.client ?? new S3Client({ region: options.region, maxAttempts: 1 });
  }

  async put(input: MediaPutInput): Promise<{ mediaId: string }> {
    const record = recordFor(input);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: record.storageKey,
        Body: input.bytes,
        ContentType: record.contentType,
        CacheControl: 'no-store',
      }),
    );
    try {
      await this.options.repository.insert(record);
    } catch (error) {
      await this.client
        .send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: record.storageKey }))
        .catch(() => undefined);
      throw error;
    }
    return { mediaId: record.id };
  }

  async resolveImage(id: string): Promise<ResolvedImage> {
    const record = await imageRecord(this.options.repository, id);
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.options.bucket,
        Key: record.storageKey,
        ResponseContentType: record.contentType,
        ResponseCacheControl: 'no-store',
      }),
      { expiresIn: 60 },
    );
    return { kind: 'redirect', url };
  }
}

export function createMediaStore(
  config: ApiConfig['media'],
  repository: MediaMetadataRepository,
): MediaStore {
  if (config.driver === 'filesystem')
    return new LocalFilesystemMediaStore(config.localDir, repository);
  if (!config.bucket || !config.region)
    throw new Error('MEDIA_BUCKET and AWS_REGION are required.');
  return new S3MediaStore({ bucket: config.bucket, region: config.region, repository });
}
