import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import type {
  Experience,
  ExperienceDraft,
  Job,
  LearningItem,
  Study,
  StudySnapshot,
  User,
} from '../../packages/contracts/src/index.js';
import { readLocalEnvironment, workspaceRoot } from './environment.js';

// This deliberately uses the explicit fixture AI with real PostgreSQL, HTTP and
// filesystem bytes. It proves image packaging/persistence, never live AI or G3.
const local = readLocalEnvironment();
const databaseName = `${local.DB_NAME ?? 'devday_study'}_image_${Date.now()}`;
assert.ok(
  Buffer.byteLength(databaseName) <= 63,
  'DB_NAME must leave room for the isolated image-check suffix.',
);
const environment = {
  ...local,
  DB_NAME: databaseName,
  AI_MODE: 'mock',
  OPENAI_API_KEY: '',
  PORT: '3100',
  WEB_PORT: '5176',
  LOCAL_WEB_ORIGIN: 'http://localhost:5176',
  SESSION_COOKIE_SECURE: 'false',
  MEDIA_LOCAL_DIR: resolve(workspaceRoot, '.local/image-validation-media'),
};
mkdirSync(environment.MEDIA_LOCAL_DIR, { recursive: true });
const base = 'http://127.0.0.1:3100';
function command(program: string, args: string[]) {
  const result = spawnSync(program, args, {
    cwd: workspaceRoot,
    env: environment,
    stdio: 'inherit',
    timeout: 120_000,
  });
  if (result.status !== 0) throw new Error(`${program} ${args.slice(0, 2).join(' ')} failed.`);
}
const imageInfo = spawnSync(
  'docker',
  ['image', 'inspect', 'devday-study-api:local', '--format', '{{.Os}}/{{.Architecture}} {{.Id}}'],
  { encoding: 'utf8' },
);
assert.equal(imageInfo.status, 0, 'Build the image with pnpm build:api-image first.');
const [platform, containerImageId] = imageInfo.stdout.trim().split(' ');
assert.equal(platform, 'linux/amd64');
// An API startup marks interrupted jobs failed, so a distinct database matters
// even when fixture users have unique handles. Never truncate/drop shared data.
const admin = new Pool({
  host: local.DB_HOST ?? '127.0.0.1',
  port: Number(local.DB_PORT ?? 5432),
  user: local.DB_USER,
  password: local.DB_PASSWORD,
  database: local.DB_NAME,
});
try {
  if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [databaseName])).rowCount) {
    await admin.query(`CREATE DATABASE "${databaseName.replaceAll('"', '""')}"`);
  }
} finally {
  await admin.end();
}
command('pnpm', ['exec', 'tsx', 'scripts/local/services.ts', 'migrate']);
command('pnpm', ['exec', 'tsx', 'scripts/local/services.ts', 'api']);

class Session {
  cookie = '';
  async request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${base}/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        Origin: environment.LOCAL_WEB_ORIGIN,
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const envelope = (await response.json()) as { data: T; error?: { code: string } };
    if (!response.ok)
      throw new Error(
        `Image API ${path} returned ${response.status}/${envelope.error?.code ?? 'unknown'}.`,
      );
    const cookie = response.headers.getSetCookie()[0];
    if (cookie) this.cookie = cookie.split(';')[0]!;
    return envelope.data;
  }
  async job(id: string): Promise<Job> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await this.request<Job>(`/jobs/${id}`);
      if (result.status === 'failed')
        throw new Error(`Fixture job ${result.kind} failed: ${result.error?.code}.`);
      if (result.status === 'succeeded') return result;
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error('Fixture job did not finish within 10 seconds.');
  }
  async image(id: string): Promise<Buffer> {
    const response = await fetch(`${base}/api/v1/media/${id}`, {
      headers: { Cookie: this.cookie },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length > 16);
    return bytes;
  }
}
const a = new Session(),
  b = new Session();
const suffix = randomUUID().slice(0, 12);
const userA = await a.request<User>('/auth/register', {
  displayName: 'Image validation A',
  handle: `image-a-${suffix}`,
});
const userB = await b.request<User>('/auth/register', {
  displayName: 'Image validation B',
  handle: `image-b-${suffix}`,
});
const prepare = await a.request<Job>('/me/experience-drafts/prepare', {
  commandId: randomUUID(),
  originalText: 'I visited Busan with my friend and ordered lunch at a restaurant.',
  answers: [],
  skipQuestions: true,
});
const prepared = await a.job(prepare.id);
assert.equal(prepared.kind, 'experience.prepare');
const draft = (prepared.result as { draft: ExperienceDraft }).draft;
const experience = await a.request<Experience>('/me/experiences', {
  commandId: randomUUID(),
  draftId: draft.id,
  originalText: draft.originalText,
  answers: draft.answers,
  summary: draft.summary,
  interests: draft.interests,
  context: draft.context,
});
const study = await a.request<Study>('/studies', {
  commandId: randomUUID(),
  participantHandles: [userB.handle],
});
await b.request(`/studies/${study.id}/join`, { commandId: randomUUID() });
async function transition(type: 'study.start' | 'topic.close' | 'study.finish') {
  const snapshot = await a.request<StudySnapshot>(`/studies/${study.id}`);
  const result = await a.request<{ jobId: string | null }>(`/studies/${study.id}/commands`, {
    commandId: randomUUID(),
    type,
    expectedTopicId: snapshot.topic?.id ?? null,
    expectedTransitionVersion: snapshot.study.transitionVersion,
    ...(type === 'study.start' ? { focusUserId: null } : {}),
  });
  if (result.jobId) await a.job(result.jobId);
}
await transition('study.start');
const snapshot = await a.request<StudySnapshot>(`/studies/${study.id}`);
assert.equal(snapshot.topic?.content?.kind, 'image');
const imageId = snapshot.topic!.content!.imageMediaId!;
const imageBefore = await a.image(imageId);
const chat = await a.request<{ job: Job }>(`/studies/${study.id}/chat/messages`, {
  text: 'resilient 단어 뜻 알려줘',
  clientMessageId: randomUUID(),
});
await a.job(chat.job.id);
const learningBefore = await a.request<LearningItem[]>('/me/learning-items');
assert.ok(
  learningBefore.length > 0,
  'Fixture chat must create a persistent personal learning item.',
);
assert.ok(learningBefore.every((item) => item.ownerUserId === userA.id));
assert.equal((await b.request<LearningItem[]>('/me/learning-items')).length, 0);
await transition('topic.close');
await transition('study.finish');
assert.equal((await a.request<StudySnapshot>(`/studies/${study.id}`)).study.status, 'ended');

command('pnpm', ['exec', 'tsx', 'scripts/local/services.ts', 'restart-api']);
for (let attempt = 0; attempt < 60; attempt++) {
  const ready = await fetch(`${base}/readyz`)
    .then((r) => r.ok)
    .catch(() => false);
  if (ready) break;
  if (attempt === 59) throw new Error('Image did not become ready after restart.');
  await new Promise((done) => setTimeout(done, 500));
}
assert.deepEqual(await a.request<LearningItem[]>('/me/learning-items'), learningBefore);
assert.ok(
  (await a.request<Experience[]>('/me/experiences')).some(
    (item) => item.id === experience.id && item.summary === experience.summary,
  ),
);
assert.equal((await a.request<User>('/me')).id, userA.id);
assert.deepEqual(await a.image(imageId), imageBefore);
assert.equal((await b.request<LearningItem[]>('/me/learning-items')).length, 0);
const result = {
  passedAt: new Date().toISOString(),
  platform: 'linux/amd64',
  containerImageId,
  aiMode: 'mock',
  database: 'PostgreSQL 17',
  databaseName,
  sameMigration: true,
  imageRestartPersistence: true,
  studyId: study.id,
  experienceId: experience.id,
  learningItems: learningBefore.length,
  imageId,
  imageBytes: imageBefore.length,
  imageSha256: createHash('sha256').update(imageBefore).digest('hex'),
  limitation:
    'Explicit fixture AI; no physical microphone, live OpenAI or two-device acceptance claim.',
};
writeFileSync(
  resolve(workspaceRoot, '.local/image-validation-result.json'),
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(JSON.stringify(result, null, 2));
