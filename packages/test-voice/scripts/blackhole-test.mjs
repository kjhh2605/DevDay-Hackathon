// Explicit live test: real OS loopback, browser microphone and product API. No fake media.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { parseEnv } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { playSamples } from '../src/play.mjs';
import { inspectWav } from '../src/wav.mjs';
import { verifySpacing } from '../src/spacing.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const dir = join(root, '.local/test-voice');
const env = parseEnv(await readFile(join(root, '.env.local'), 'utf8'));
const origin = process.env.TEST_VOICE_ORIGIN ?? env.LOCAL_WEB_ORIGIN;
const ids = process.argv.filter((arg) => arg.startsWith('--sample=')).map((arg) => arg.slice(9));
if (!process.argv.includes('--run') || !ids.length) {
  console.log(
    'Live paid test: node packages/test-voice/scripts/blackhole-test.mjs --run --sample=mixed-missing-word',
  );
  process.exit(1);
}
const { selectSamples } = await import('../src/samples.mjs');
for (const id of ids) selectSamples(id);
await mkdir(dir, { recursive: true });
const native = join(dir, 'coreaudio');
execFileSync('swiftc', [join(root, 'packages/test-voice/scripts/coreaudio.swift'), '-o', native]);
const devices = (...args) => JSON.parse(execFileSync(native, args, { encoding: 'utf8' }));
const original = devices();
const blackhole = original.devices.find((item) => item.name === 'BlackHole 2ch');
assert(blackhole, 'BlackHole 2ch must be installed and loaded');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidencePath = join(dir, `blackhole-${runId}.json`);
const evidence = {
  startedAt: new Date().toISOString(),
  origin,
  status: 'running',
  originalDevices: original,
  fakeMedia: false,
  samples: [],
  sent: {},
  received: {},
  errors: [],
};
const save = () => writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
let browser;
let context;
let page;
let progress;
const controller = new AbortController();
const stop = () => controller.abort();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
try {
  await save();
  evidence.testDevices = devices('set', String(blackhole.id), String(blackhole.id));
  browser = await chromium.launch({ channel: 'chrome', headless: false });
  context = await browser.newContext({
    baseURL: origin,
    permissions: ['microphone'],
    viewport: { width: 1440, height: 1000 },
  });
  async function call(path, body) {
    const response =
      body === undefined
        ? await context.request.get(`/api/v1${path}`)
        : await context.request.post(`/api/v1${path}`, { data: body });
    const json = await response.json();
    assert(response.ok(), `${path}: HTTP ${response.status()} ${json.error?.code ?? ''}`);
    return json.data;
  }
  const suffix = Date.now().toString(36);
  const user = await call('/auth/register', {
    displayName: 'BlackHole 혼용 테스트',
    handle: `voice_${suffix}`,
  });
  const prepared = await call('/me/experience-drafts/prepare', {
    originalText:
      '지난 주말 친구와 한강 공원에 갔다가 식당을 예약했어요. 영어로 대화하다가 모르는 단어나 표현은 한국어로 말했어요.',
    answers: [],
    skipQuestions: true,
    commandId: randomUUID(),
  });
  let draft;
  console.log('Preparing test experience with the real service...');
  for (let i = 0; i < 240; i++) {
    const job = await call(`/jobs/${prepared.id}`);
    assert(job.status !== 'failed', `Experience preparation failed: ${job.error?.code}`);
    if (job.status === 'succeeded') {
      draft = job.result.draft;
      break;
    }
    await sleep(1000);
  }
  assert(draft, 'Experience preparation timed out');
  await call('/me/experiences', {
    originalText: draft.originalText,
    answers: draft.answers,
    summary: draft.summary,
    interests: draft.interests,
    context: draft.context,
    draftId: draft.id,
    commandId: randomUUID(),
  });
  const study = await call('/studies', { participantHandles: [], commandId: randomUUID() });
  evidence.userId = user.id;
  evidence.studyId = study.id;
  const snapshot = () => call(`/studies/${study.id}`);
  let state = await snapshot();
  await call(`/studies/${study.id}/commands`, {
    type: 'study.start',
    commandId: randomUUID(),
    expectedTopicId: state.study.currentTopicId,
    expectedTransitionVersion: state.study.transitionVersion,
    focusUserId: null,
  });
  console.log(`Live test study: ${origin}/study/${study.id}`);
  for (let i = 0; i < 240; i++) {
    controller.signal.throwIfAborted();
    state = await snapshot();
    if (state.topic?.state === 'talking') break;
    assert(state.topic?.state !== 'failed', 'Topic generation failed');
    await sleep(1000);
  }
  assert.equal(state.topic?.state, 'talking');
  evidence.topicId = state.topic.id;
  page = await context.newPage();
  await page.addInitScript(() => {
    window.__voiceTracks = [];
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await capture(constraints);
      window.__voiceTracks.push(...stream.getAudioTracks());
      return stream;
    };
  });
  page.on('websocket', (socket) => {
    if (!socket.url().includes('/ws/audio')) return;
    socket.on('framesent', ({ payload }) => {
      const frame = JSON.parse(String(payload));
      evidence.sent[frame.type] = (evidence.sent[frame.type] ?? 0) + 1;
      if (frame.type === 'audio.start')
        evidence.wireFormat = {
          format: frame.format,
          sampleRate: frame.sampleRate,
          channels: frame.channels,
        };
    });
    socket.on('framereceived', ({ payload }) => {
      const frame = JSON.parse(String(payload));
      evidence.received[frame.type] = (evidence.received[frame.type] ?? 0) + 1;
      if (frame.type === 'audio.error' || frame.type === 'audio.processing_error')
        evidence.errors.push(frame);
    });
  });
  page.on('pageerror', (error) =>
    evidence.errors.push({ type: 'pageerror', message: error.message }),
  );
  await page.goto(`${origin}/study/${study.id}`);
  await page.getByRole('button', { name: '마이크 켜기', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="마이크 끄기"]')?.textContent.includes('마이크 켜짐'),
    undefined,
    { timeout: 45000 },
  );
  evidence.captureDevices = await page.evaluate(() =>
    window.__voiceTracks.map((track) => ({ label: track.label, settings: track.getSettings() })),
  );
  assert(
    evidence.captureDevices.some((track) => track.label.includes('BlackHole')),
    'Actual getUserMedia track must be BlackHole',
  );
  assert.deepEqual(evidence.wireFormat, { format: 'pcm16', sampleRate: 24000, channels: 1 });
  await save();
  progress = setInterval(
    () =>
      console.log(
        `Captured chunks=${evidence.sent['audio.chunk'] ?? 0}, committed=${evidence.received['audio.segment_committed'] ?? 0}, errors=${evidence.errors.length}`,
      ),
    15000,
  );
  for (const id of ids) {
    const path = join(dir, `${id}.wav`);
    const wav = await readFile(path);
    const metadata = JSON.parse(await readFile(join(dir, `${id}.json`), 'utf8'));
    const source = {
      id,
      sha256: createHash('sha256').update(wav).digest('hex'),
      ...inspectWav(wav),
      spacing: verifySpacing(wav, metadata),
      expectedText: metadata.text,
    };
    source.startedAt = new Date().toISOString();
    const before = (await snapshot()).segments.length;
    await playSamples({ paths: [path], delay: 3, gap: 5, signal: controller.signal });
    source.endedAt = new Date().toISOString();
    source.newSegments = (await snapshot()).segments.slice(before).map((segment) => segment.id);
    evidence.samples.push(source);
    await save();
  }
  await page.getByRole('button', { name: '마이크 끄기', exact: true }).click();
  for (let i = 0; i < 90; i++) {
    state = await snapshot();
    if (
      state.segments.length &&
      state.segments.every((segment) => !['pending', 'running'].includes(segment.rawStatus))
    )
      break;
    await sleep(1000);
  }
  evidence.segments = state.segments;
  evidence.speechGroups = state.speechGroups;
  evidence.utterances = state.utterances;
  evidence.visibleText = await page.locator('body').innerText();
  evidence.screenshot = join(dir, `blackhole-${runId}.png`);
  try {
    await page.screenshot({
      path: evidence.screenshot,
      fullPage: false,
      animations: 'disabled',
      timeout: 10000,
    });
  } catch (error) {
    evidence.artifactWarning = error.message;
    delete evidence.screenshot;
  }
  assert((evidence.sent['audio.chunk'] ?? 0) > 0, 'No microphone PCM transmitted');
  assert(
    state.segments.some((segment) => segment.rawStatus === 'ready' && segment.rawText?.trim()),
    'No real service transcription received',
  );
  evidence.transcript = state.segments.map((segment) => segment.rawText ?? '').join(' ');
  evidence.koreanPreserved = /[가-힣]/u.test(evidence.transcript);
  evidence.englishPreserved = /[a-z]/iu.test(evidence.transcript);
  // Transport success alone must not masquerade as correct mixed-language recognition.
  const anchors = {
    'mixed-missing-word': ['예약', '품절'],
    'mixed-missing-expression': ['눈치가', '보여서', '말을', '못', '했어요', '미뤘어요'],
  };
  for (const source of evidence.samples) {
    source.transcript = state.segments
      .filter((segment) => source.newSegments.includes(segment.id))
      .map((segment) => segment.rawText ?? '')
      .join(' ');
    source.expectedKorean = anchors[source.id] ?? [];
    source.missingKorean = source.expectedKorean.filter(
      (word) => !source.transcript.replace(/\s/gu, '').includes(word),
    );
  }
  evidence.transportStatus = 'passed';
  evidence.recognitionStatus = evidence.samples.some((sample) => sample.missingKorean.length)
    ? 'needs-review'
    : 'anchors-present';
  assert.equal(evidence.errors.length, 0, 'Browser/audio processing errors occurred; see evidence');
  evidence.status =
    evidence.recognitionStatus === 'needs-review' ? 'passed-with-recognition-issues' : 'passed';
} catch (error) {
  evidence.status = 'failed';
  evidence.failure = error.message;
  if (page) {
    evidence.visibleText = await page
      .locator('body')
      .innerText()
      .catch(() => 'unavailable');
    evidence.screenshot = join(dir, `blackhole-${runId}-failed.png`);
    await page
      .screenshot({
        path: evidence.screenshot,
        fullPage: false,
        animations: 'disabled',
        timeout: 10000,
      })
      .catch(() => {
        delete evidence.screenshot;
      });
  }
  console.error(error.message);
  process.exitCode = 1;
} finally {
  clearInterval(progress);
  try {
    await browser?.close();
  } finally {
    evidence.restoredDevices = devices(
      'set',
      String(original.defaultInput),
      String(original.defaultOutput),
    );
  }
  evidence.finishedAt = new Date().toISOString();
  await save();
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  console.log(`Evidence: ${evidencePath} (${evidence.status})`);
}
