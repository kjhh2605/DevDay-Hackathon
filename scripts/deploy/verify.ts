import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ActorClient } from '../../tests/live/flow.js';
import { UserSchema } from '../../packages/contracts/src/index.js';
import { workspaceRoot } from '../local/environment.js';
import { loadDeployEnvironment, verifyAccount } from './environment.js';
import { output, receiptPath, stackNames, stackOutputs, writeReceipt } from './operations.js';

const config = loadDeployEnvironment();
verifyAccount(config);
const origin = output(stackOutputs(config, stackNames.edge), 'AppUrl');
assert.equal(new URL(origin).protocol, 'https:');
const a = new ActorClient(origin, origin),
  b = new ActorClient(origin, origin);
const sessionFile = receiptPath(config, 'verification-session');
const report: Record<string, unknown> = {
  origin,
  startedAt: new Date().toISOString(),
  physicalMicrophones: 'not_run',
};
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function imageBytes(mediaId: string) {
  const response = await fetch(`${origin}/api/v1/media/${mediaId}`, {
    headers: { cookie: a.cookie },
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 302);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  const location = response.headers.get('location');
  assert(location);
  assert.equal(new URL(location).protocol, 'https:');
  const image = await fetch(location, { signal: AbortSignal.timeout(30000) });
  assert.equal(image.status, 200);
  assert.match(image.headers.get('content-type') ?? '', /^image\//);
  const bytes = Buffer.from(await image.arrayBuffer());
  assert(bytes.length > 1024);
  return bytes;
}
try {
  if (process.argv.includes('--after-restart')) {
    const saved = JSON.parse(readFileSync(sessionFile, 'utf8'));
    assert.equal(saved.origin, origin);
    a.cookie = saved.a.cookie;
    b.cookie = saved.b.cookie;
    assert.deepEqual(await a.call('me', undefined), saved.a.user);
    assert.deepEqual(await a.call('experiences', undefined), saved.experiences);
    assert.deepEqual(await a.call('learningItems', undefined), saved.learning);
    assert.equal(sha(await imageBytes(saved.mediaId)), saved.imageSha256);
    assert.equal((await b.snapshot(saved.studyId)).study.status, 'ended');
    report.restartPersistence = 'pass';
    report.imageSha256 = saved.imageSha256;
  } else {
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') ?? '', /text\/html/);
    assert.match(page.headers.get('cache-control') ?? '', /no-cache/);
    const html = await page.text();
    const asset = html.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1];
    assert(asset);
    assert.match((await fetch(origin + asset)).headers.get('cache-control') ?? '', /immutable/);
    const anonymous = await fetch(`${origin}/api/v1/me`);
    assert.equal(anonymous.status, 401);
    assert.match(anonymous.headers.get('content-type') ?? '', /application\/json/);
    assert.match(anonymous.headers.get('cache-control') ?? '', /no-store/);
    for (const [actor, label] of [
      [a, 'A'],
      [b, 'B'],
    ] as const) {
      const response = await fetch(`${origin}/api/v1/auth/register`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: `AWS validation ${label}`,
          handle: `aws-${label.toLowerCase()}-${randomUUID().slice(0, 12)}`,
        }),
      });
      assert(response.ok);
      const cookie = response.headers.get('set-cookie') ?? '';
      for (const pattern of [/; Secure(?:;|$)/i, /; HttpOnly(?:;|$)/i, /; SameSite=Lax(?:;|$)/i])
        assert.match(cookie, pattern);
      actor.cookie = cookie.split(';')[0]!;
      actor.user = UserSchema.parse(((await response.json()) as { data: unknown }).data);
      await actor.connectEvents();
      const audio = await actor.openSocket('/ws/audio');
      audio.close();
    }
    assert.notEqual(a.cookie, b.cookie);
    const meA = await a.call('me', undefined),
      meB = await b.call('me', undefined);
    assert.notEqual(meA.id, meB.id);
    report.httpsCookiesCacheAndWss = 'pass';
    console.log('PASS CloudFront HTTPS, cookies, private cache boundary, events/audio WSS');

    const prepared = await a.call('prepareExperience', {
      originalText:
        '어제 친구와 부산 해변 근처 카페에 갔어요. 커피를 마시며 여행에 대해 이야기했어요.',
      answers: [],
      skipQuestions: true,
      commandId: randomUUID(),
    });
    const job = await a.job(prepared.id);
    assert(job.kind === 'experience.prepare' && job.result);
    const draft = job.result.draft;
    assert(draft.summary);
    await a.call('createExperience', {
      draftId: draft.id,
      originalText: draft.originalText,
      answers: draft.answers,
      summary: draft.summary,
      interests: draft.interests,
      context: draft.context,
      commandId: randomUUID(),
    });
    const study = await a.call('createStudy', {
      participantHandles: [b.user.handle],
      commandId: randomUUID(),
    });
    await b.event(
      (event) => event.type === 'invitation.created' && event.payload.studyId === study.id,
      'AWS invitation',
    );
    await b.call('joinStudy', { commandId: randomUUID() }, { studyId: study.id });
    await Promise.all([a.subscribe(study.id), b.subscribe(study.id)]);
    const started = await a.command(study.id, 'study.start');
    assert(started.jobId);
    await a.job(started.jobId);
    const snapshot = await b.snapshot(study.id);
    assert(snapshot.topic?.content?.kind === 'image');
    const mediaId = snapshot.topic.content.imageMediaId;
    const bytes = await imageBytes(mediaId);
    const word = await a.chat(study.id, 'What does souvenir mean?');
    assert(word.learningItemIds.length > 0);
    assert.deepEqual(await b.call('learningItems', undefined), []);
    const close = await a.command(study.id, 'study.finish');
    if (close.jobId) await a.job(close.jobId);
    if ((await a.snapshot(study.id)).study.status !== 'ended')
      await a.command(study.id, 'study.finish');
    assert.equal((await b.snapshot(study.id)).study.status, 'ended');
    const saved = {
      origin,
      studyId: study.id,
      mediaId,
      imageSha256: sha(bytes),
      a: { user: a.user, cookie: a.cookie },
      b: { user: b.user, cookie: b.cookie },
      experiences: await a.call('experiences', undefined),
      learning: await a.call('learningItems', undefined),
    };
    mkdirSync(resolve(sessionFile, '..'), { recursive: true });
    writeFileSync(sessionFile, JSON.stringify(saved), { mode: 0o600 });
    report.liveOpenAiRdsS3 = 'pass';
    report.imageSha256 = saved.imageSha256;
    report.imageBytes = bytes.length;
    report.studyId = study.id;
    console.log(
      'PASS real OpenAI experience/image/chat, RDS records, S3 signed bytes and two-user events',
    );
  }
  report.result = 'pass';
} catch (error) {
  report.result = 'failed';
  report.error = error instanceof Error ? error.message : 'AWS verification failed';
  process.exitCode = 1;
  console.error(report.error);
} finally {
  a.eventSocket?.close();
  b.eventSocket?.close();
  report.finishedAt = new Date().toISOString();
  writeReceipt(
    config,
    process.argv.includes('--after-restart') ? 'verification-restart' : 'verification',
    report,
  );
  const directory = resolve(workspaceRoot, 'docs/implementation/evidence/reports');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(
      directory,
      process.argv.includes('--after-restart') ? 'aws-restart.json' : 'aws-verification.json',
    ),
    JSON.stringify(report, null, 2) + '\n',
  );
}
