import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';

// This checks a real browser audio graph with a generated microphone signal and
// mocked audio protocol, independently of physical devices and paid OpenAI calls.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(packageRoot, '../..');
const require = createRequire(import.meta.url);
const { build } = await import(
  pathToFileURL(require.resolve('vite', { paths: [resolve(root, 'apps/web')] })).href
);
const temporary = await mkdtemp(resolve(tmpdir(), 'devday-audio-browser-'));
let browser;
let server;
try {
  await build({
    configFile: false,
    root: packageRoot,
    logLevel: 'error',
    build: {
      outDir: resolve(temporary, 'dist'),
      minify: true,
      lib: {
        entry: resolve(packageRoot, 'src/index.ts'),
        name: 'DevdayAudio',
        formats: ['iife'],
        fileName: () => 'audio.js',
      },
    },
  });
  const bundle = await readFile(resolve(temporary, 'dist/audio.js'));
  const rate = 48_000;
  const samples = rate * 8;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) {
    // Two speech-like tones separated by >700 ms silence exercise a VAD commit
    // while the first server readiness acknowledgement is still delayed.
    const silence = index >= rate * 0.5 && index < rate * 1.4;
    wav.writeInt16LE(
      silence ? 0 : Math.round(0.35 * 32767 * Math.sin((2 * Math.PI * 440 * index) / rate)),
      44 + index * 2,
    );
  }
  const wavPath = resolve(temporary, 'microphone.wav');
  await writeFile(wavPath, wav);
  server = createServer((request, response) => {
    response.setHeader(
      'Content-Type',
      request.url === '/audio.js' ? 'text/javascript' : 'text/html',
    );
    response.end(
      request.url === '/audio.js'
        ? bundle
        : '<!doctype html><title>Audio browser validation</title><script src="/audio.js"></script>',
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${wavPath}`,
    ],
  });
  const page = await browser.newPage();
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  const received = [];
  const protocolFailures = [];
  const segmentCaptureTimes = [];
  const acknowledgedSegments = [];
  let segmentOrdinal = 0;
  await page.routeWebSocket('**/ws/audio', (socket) => {
    const streamId = randomUUID();
    let activeSegment = null;
    let lastSegment = null;
    socket.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      received.push(message);
      const send = (value) => socket.send(JSON.stringify(value));
      const check = (condition, reason) => {
        if (condition) return true;
        protocolFailures.push(reason);
        send({
          type: 'audio.error',
          error: { code: 'AUDIO_FAILED', message: reason, details: null },
          requestId: randomUUID(),
        });
        return false;
      };
      if (message.type === 'audio.start')
        send({ type: 'audio.ready', streamId, topicId: message.topicId });
      else if (message.type === 'audio.segment_start') {
        if (!check(activeSegment === null, 'SEGMENT_ALREADY_ACTIVE')) return;
        const segment = {
          clientId: message.clientSegmentId,
          id: randomUUID(),
          ready: false,
          nextSeq: 0,
          ordinal: segmentOrdinal++,
        };
        activeSegment = segment;
        segmentCaptureTimes.push({
          startedAt: Date.parse(message.startedAt),
          receivedAt: Date.now(),
        });
        setTimeout(
          () => {
            segment.ready = true;
            acknowledgedSegments.push({ ordinal: segment.ordinal, at: Date.now() });
            send({
              type: 'audio.segment_ready',
              clientSegmentId: segment.clientId,
              segmentId: segment.id,
              startOrder: segment.ordinal,
            });
          },
          segment.ordinal === 0 ? 1_900 : 0,
        );
      } else if (message.type === 'audio.chunk') {
        if (
          !check(
            activeSegment?.clientId === message.clientSegmentId && activeSegment.ready,
            'SEGMENT_NOT_READY',
          )
        )
          return;
        if (!check(message.seq === activeSegment.nextSeq, 'INVALID_SEQUENCE')) return;
        activeSegment.nextSeq++;
      } else if (message.type === 'audio.segment_commit') {
        if (
          !check(
            activeSegment?.clientId === message.clientSegmentId && activeSegment.ready,
            'SEGMENT_NOT_READY',
          )
        )
          return;
        if (!check(message.lastSeq === activeSegment.nextSeq - 1, 'INVALID_COMMIT_SEQUENCE'))
          return;
        lastSegment = activeSegment;
        activeSegment = null;
      } else if (message.type === 'audio.flush') {
        if (!check(activeSegment === null, 'UNCOMMITTED_SEGMENT')) return;
        if (
          !check(
            message.lastSegmentId === (lastSegment?.id ?? null) &&
              message.lastSeq === (lastSegment ? lastSegment.nextSeq - 1 : null),
            'INVALID_FLUSH_SEQUENCE',
          )
        )
          return;
        send({ type: 'audio.flushed', streamId, closeId: message.closeId });
      } else if (message.type === 'heartbeat.ping') send({ type: 'heartbeat.pong' });
    });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async (topicId) => {
    window.mediaCalls = 0;
    window.tracks = [];
    window.states = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.mediaCalls++;
      const stream = await original(constraints);
      window.tracks.push(...stream.getAudioTracks());
      return stream;
    };
    window.capture = window.DevdayAudio.createCaptureController({
      onState: (state) => window.states.push(state.status),
    });
    await window.capture.startCapture(topicId);
  }, randomUUID());
  await page.waitForTimeout(2_700);
  await page.evaluate((closeId) => window.capture.flush(closeId), randomUUID());
  const firstCount = received.length;
  await page.waitForTimeout(250);
  assert.equal(received.length, firstCount, 'Review must not transmit surrounding audio');
  const firstChunks = received.filter((item) => item.type === 'audio.chunk');
  assert.equal(
    received.filter((item) => item.type === 'audio.segment_start').length,
    2,
    'The first topic must capture two VAD segments across the delayed readiness boundary',
  );
  assert.ok(
    segmentCaptureTimes[1].startedAt < acknowledgedSegments[0].at - 100,
    'The second segment must be captured before the first segment is ready',
  );
  assert.ok(
    segmentCaptureTimes[1].receivedAt >= acknowledgedSegments[0].at,
    'The second segment must reach the server only after the preceding segment is ready and committed',
  );
  assert.ok(firstChunks.length >= 3, 'Real AudioWorklet must send captured PCM');
  assert.ok(
    firstChunks.some((item) => Buffer.from(item.pcmBase64, 'base64').some((byte) => byte !== 0)),
    'Captured PCM must contain the fake microphone tone',
  );
  await page.evaluate((topicId) => window.capture.startCapture(topicId), randomUUID());
  await page.waitForTimeout(500);
  await page.evaluate((closeId) => window.capture.flush(closeId), randomUUID());
  await page.evaluate(() => window.capture.stopCapture());
  const outcome = await page.evaluate(() => ({
    mediaCalls: window.mediaCalls,
    tracksEnded: window.tracks.every((track) => track.readyState === 'ended'),
    states: window.states,
  }));
  assert.equal(
    outcome.mediaCalls,
    1,
    'The permitted microphone should be reused for the next topic',
  );
  assert.equal(outcome.tracksEnded, true, 'Explicit stop must release the physical microphone');
  assert.deepEqual(browserErrors, []);
  assert.deepEqual(
    protocolFailures,
    [],
    'Every segment must obey the real server active-segment invariant',
  );
  const starts = received.filter((item) => item.type === 'audio.start');
  assert.ok(
    received
      .filter((item) => item.type === 'audio.segment_start')
      .every((item) => Number.isFinite(Date.parse(item.startedAt))),
    'Browser segments must include capture-based timestamps',
  );
  const flushes = received.filter((item) => item.type === 'audio.flush');
  assert.equal(starts.length, 2);
  assert.equal(flushes.length, 2);
  assert.notEqual(starts[0].clientStreamId, starts[1].clientStreamId);
  assert.ok(flushes.every((item) => item.lastSegmentId !== null && item.lastSeq >= 0));
  console.log(
    JSON.stringify({
      status: 'passed',
      test: 'real Chromium / generated microphone / minified production bundle',
      streams: starts.length,
      segments: segmentOrdinal,
      delayedReadinessMs: 1_900,
      chunks: received.filter((item) => item.type === 'audio.chunk').length,
      ...outcome,
    }),
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
