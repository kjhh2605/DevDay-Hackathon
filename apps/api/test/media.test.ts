import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMediaStore,
  LocalFilesystemMediaStore,
  MediaNotFoundError,
  S3MediaStore,
  type MediaMetadata,
  type MediaMetadataRepository,
} from '../src/storage/media.js';

const temporary: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
function repository(): MediaMetadataRepository & { records: Map<string, MediaMetadata> } {
  const records = new Map<string, MediaMetadata>();
  return {
    records,
    async insert(record) {
      records.set(record.id, record);
    },
    async findById(id) {
      return records.get(id);
    },
  };
}
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'devday-media-'));
  temporary.push(root);
  return root;
}
const imageInput = {
  studyId: 'study-a',
  kind: 'image' as const,
  bytes: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
  contentType: 'image/png',
};

describe('local media storage', () => {
  it('persists exact bytes and resolves through a new adapter instance', async () => {
    const root = await directory();
    const metadata = repository();
    const first = createMediaStore({ driver: 'filesystem', localDir: root }, metadata);
    const result = await first.put(imageInput);
    const stored = metadata.records.get(result.mediaId)!;
    expect(new Uint8Array(await readFile(join(root, stored.storageKey)))).toEqual(imageInput.bytes);
    const restarted = new LocalFilesystemMediaStore(root, metadata);
    const resolved = await restarted.resolveImage(result.mediaId);
    expect(resolved.kind).toBe('bytes');
    if (resolved.kind === 'bytes') {
      expect(new Uint8Array(resolved.bytes)).toEqual(imageInput.bytes);
      expect(resolved.contentType).toBe('image/png');
    }
  });

  it('stores audio privately and never serves it from the image resolver', async () => {
    const store = new LocalFilesystemMediaStore(await directory(), repository());
    const audio = await store.put({
      ...imageInput,
      kind: 'audio',
      segmentId: 'segment-a',
      contentType: 'audio/wav',
    });
    await expect(store.resolveImage(audio.mediaId)).rejects.toBeInstanceOf(MediaNotFoundError);
    await expect(store.resolveImage('missing')).rejects.toBeInstanceOf(MediaNotFoundError);
    await expect(
      store.put({ ...imageInput, kind: 'audio', contentType: 'audio/wav' }),
    ).rejects.toThrow('segment');
  });

  it('removes bytes if metadata persistence fails', async () => {
    const root = await directory();
    const metadata = repository();
    metadata.insert = async () => {
      throw new Error('Database unavailable');
    };
    const store = new LocalFilesystemMediaStore(root, metadata);
    await expect(store.put(imageInput)).rejects.toThrow('Database unavailable');
    expect(await readdir(join(root, 'image'))).toEqual([]);
  });

  it('rejects content that could be served as executable markup and refuses escaping metadata paths', async () => {
    const metadata = repository();
    const store = new LocalFilesystemMediaStore(await directory(), metadata);
    await expect(store.put({ ...imageInput, contentType: 'image/svg+xml' })).rejects.toThrow(
      'content type',
    );
    await expect(store.put({ ...imageInput, bytes: new Uint8Array() })).rejects.toThrow(
      'non-empty',
    );
    metadata.records.set('unsafe', {
      id: 'unsafe',
      studyId: 'a',
      segmentId: null,
      kind: 'image',
      storageKey: '../../outside',
      contentType: 'image/png',
    });
    await expect(store.resolveImage('unsafe')).rejects.toBeInstanceOf(MediaNotFoundError);
  });
});

describe('S3 media adapter', () => {
  it('writes actual bytes with private cache policy and signs only image keys', async () => {
    const metadata = repository();
    const client = new S3Client({
      region: 'ap-northeast-2',
      maxAttempts: 1,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    const send = vi.spyOn(client, 'send').mockResolvedValue({} as never);
    const store = new S3MediaStore({
      bucket: 'private-media',
      region: 'ap-northeast-2',
      repository: metadata,
      client,
    });
    const { mediaId } = await store.put(imageInput);
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    if (!(command instanceof PutObjectCommand)) throw new Error('Expected an S3 upload command');
    expect(command.input.Body).toEqual(imageInput.bytes);
    expect(command.input.CacheControl).toBe('no-store');
    expect(command.input).not.toHaveProperty('ACL');
    const result = await store.resolveImage(mediaId);
    expect(result.kind).toBe('redirect');
    if (result.kind === 'redirect') {
      const url = new URL(result.url);
      expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
      expect(url.searchParams.get('response-cache-control')).toBe('no-store');
    }
    const audio = await store.put({
      ...imageInput,
      kind: 'audio',
      segmentId: 'segment-a',
      contentType: 'audio/wav',
    });
    await expect(store.resolveImage(audio.mediaId)).rejects.toBeInstanceOf(MediaNotFoundError);
    client.destroy();
  });

  it('cleans up an uploaded object once when metadata persistence fails', async () => {
    const metadata = repository();
    metadata.insert = async () => {
      throw new Error('Database unavailable');
    };
    const client = new S3Client({
      region: 'ap-northeast-2',
      maxAttempts: 1,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    const send = vi.spyOn(client, 'send').mockResolvedValue({} as never);
    const store = new S3MediaStore({
      bucket: 'private-media',
      region: 'ap-northeast-2',
      repository: metadata,
      client,
    });
    await expect(store.put(imageInput)).rejects.toThrow('Database unavailable');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      'PutObjectCommand',
      'DeleteObjectCommand',
    ]);
    client.destroy();
  });
});
