import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { generateSamples, synthesize } from '../src/generate.mjs';
import { playSamples } from '../src/play.mjs';
import { selectSamples } from '../src/samples.mjs';
import { inspectWav, pcmToWav } from '../src/wav.mjs';
import { joinWords, spacing, synthesizeWords, trimWord, verifySpacing } from '../src/spacing.mjs';

const pcm = Buffer.alloc(48_000);
pcm.writeInt16LE(-32768, 0);
pcm.writeInt16LE(32767, 2);
const silentLog = () => {};
async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'devday-test-voice-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('WAV preserves signed LE samples, exact duration and required contract', () => {
  const wav = pcmToWav(pcm);
  assert.deepEqual(wav.subarray(44), pcm);
  assert.equal(wav.readInt16LE(44), -32768);
  assert.deepEqual(
    { ...inspectWav(wav), rms: 0 },
    {
      sampleRate: 24000,
      channels: 1,
      bitsPerSample: 16,
      encoding: 'pcm_s16le',
      durationSeconds: 1,
      peak: 1,
      rms: 0,
      bytes: 48044,
    },
  );
});

test('rejects invalid PCM, silent audio, truncated WAV, wrong format/rate/channels', () => {
  for (const invalid of [Buffer.alloc(0), Buffer.alloc(3)]) assert.throws(() => pcmToWav(invalid));
  assert.throws(() => inspectWav(pcmToWav(Buffer.alloc(4))), /무음/);
  assert.throws(() => inspectWav(pcmToWav(pcm).subarray(0, 50)));
  for (const [offset, value] of [
    [20, 3],
    [22, 2],
    [24, 48000],
    [28, 1234],
    [32, 4],
    [34, 8],
    [40, 0xffffffff],
  ]) {
    const wav = pcmToWav(pcm);
    if ([24, 28, 40].includes(offset)) wav.writeUInt32LE(value, offset);
    else wav.writeUInt16LE(value, offset);
    assert.throws(() => inspectWav(wav));
  }
});

test('accepts padded metadata chunks while checking chunk boundaries', () => {
  const wav = pcmToWav(pcm);
  const metadata = Buffer.from([74, 85, 78, 75, 1, 0, 0, 0, 65, 0]); // JUNK, odd payload, pad
  const withMetadata = Buffer.concat([wav.subarray(0, 12), metadata, wav.subarray(12)]);
  withMetadata.writeUInt32LE(withMetadata.length - 8, 4);
  assert.equal(inspectWav(withMetadata).durationSeconds, 1);
  withMetadata.writeUInt32LE(0xffffffff, 16);
  assert.throws(() => inspectWav(withMetadata));
});

test('generation persists provenance, skips unchanged audio and requires force for changes', async (t) => {
  const outDir = await temp(t);
  const selected = [{ ...selectSamples('en-correction')[0], text: 'Hello world' }];
  let calls = 0;
  const options = {
    selected,
    outDir,
    log: silentLog,
    speech: async () => {
      calls++;
      return pcm;
    },
  };
  await generateSamples(options);
  await generateSamples(options);
  assert.equal(calls, 2);
  const meta = JSON.parse(await readFile(join(outDir, 'en-correction.json'), 'utf8'));
  assert.equal(meta.synthetic, true);
  assert.equal(meta.text, selected[0].text);
  assert.equal(meta.sha256.length, 64);
  assert.equal(verifySpacing(await readFile(join(outDir, 'en-correction.wav')), meta).gaps, 1);
  const modified = pcmToWav(pcm);
  modified.writeInt16LE(123, 46);
  await writeFile(join(outDir, 'en-correction.wav'), modified);
  await assert.rejects(generateSamples(options), /--force/);
  await generateSamples({ ...options, force: true });
  assert.equal(calls, 2);
});

test('API failure preserves completed samples and creates no failed WAV', async (t) => {
  const outDir = await temp(t);
  let calls = 0;
  await assert.rejects(
    generateSamples({
      selected: selectSamples()
        .slice(0, 2)
        .map((sample, index) => ({ ...sample, text: index === 0 ? 'hello' : 'world' })),
      outDir,
      log: silentLog,
      speech: async () => {
        if (++calls === 2) throw new Error('HTTP 429');
        return pcm;
      },
    }),
    /429/,
  );
  assert(inspectWav(await readFile(join(outDir, 'ko-experience.wav'))).durationSeconds > 0);
  await assert.rejects(readFile(join(outDir, 'ko-question.wav')), { code: 'ENOENT' });
});

test('random gaps are bounded exact zero PCM and preserve original word order', () => {
  const tokens = ['I', '예약', 'please.'];
  const gaps = [1000, 10000];
  const result = joinWords(
    tokens.map((text) => ({ text, pcm })),
    () => gaps.shift(),
  );
  const wav = pcmToWav(result.pcm);
  assert.equal(inspectWav(wav).durationSeconds, 14);
  assert.deepEqual(
    result.words.map((word) => word.gapAfterSamples),
    [24000, 240000, 0],
  );
  const metadata = { spacing, words: result.words, text: tokens.join(' ') };
  assert.equal(verifySpacing(wav, metadata).gaps, 2);
  wav.writeInt16LE(1, 44 + result.words[0].endSample * 2);
  assert.throws(() => verifySpacing(wav, metadata), /무음/);
  for (const gap of [999, 10001, NaN, -1])
    assert.throws(() =>
      joinWords(
        [
          { text: 'a', pcm },
          { text: 'b', pcm },
        ],
        () => gap,
      ),
    );
  assert.throws(() => trimWord(Buffer.alloc(100)), /무음/);
});

test('mixed words retain their script and silent word retry is bounded', async (t) => {
  const cacheDir = await temp(t);
  const seen = [];
  const attempts = new Map();
  const speech = async (sample) => {
    seen.push([sample.text, sample.language, sample.isolatedWord]);
    const count = (attempts.get(sample.text) ?? 0) + 1;
    attempts.set(sample.text, count);
    return sample.text === '예약' && count === 1 ? Buffer.alloc(480) : pcm;
  };
  const result = await synthesizeWords({
    sample: { text: 'I 예약', language: 'en-ko' },
    cacheDir,
    model: 'test',
    voice: 'test',
    speech,
    log: silentLog,
  });
  assert.deepEqual(
    result.words.map((word) => word.text),
    ['I', '예약'],
  );
  assert(seen.some((value) => JSON.stringify(value) === JSON.stringify(['예약', 'ko', true])));
  assert.equal(attempts.get('예약'), 2);
  let calls = 0;
  await assert.rejects(
    synthesizeWords({
      sample: { text: 'silence', language: 'en' },
      cacheDir,
      model: 'test',
      voice: 'test',
      speech: async () => {
        calls++;
        return Buffer.alloc(480);
      },
      log: silentLog,
    }),
    /무음/,
  );
  assert.equal(calls, 3);
});

test('speech requests PCM and errors do not expose key or response body', async () => {
  const sample = selectSamples('ko-question')[0];
  const result = await synthesize(sample, 'fake-secret', async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/audio/speech');
    assert.equal(options.headers.Authorization, 'Bearer fake-secret');
    const body = JSON.parse(options.body);
    assert.equal(body.response_format, 'pcm');
    assert.equal(body.input, sample.text);
    return new Response(pcm);
  });
  assert.deepEqual(result, pcm);
  await assert.rejects(
    synthesize(sample, '', () => assert.fail('must not call API')),
    /OPENAI_API_KEY/,
  );
  await assert.rejects(
    synthesize(sample, 'fake-secret', async () => new Response('fake-secret', { status: 401 })),
    (error) => {
      assert.match(error.message, /401/);
      assert.doesNotMatch(error.message, /fake-secret/);
      return true;
    },
  );
});

test('playback validates all files first and preserves order, repeat, gaps and volume', async (t) => {
  const dir = await temp(t);
  const paths = [join(dir, 'one.wav'), join(dir, 'two.wav')];
  for (const path of paths) await writeFile(path, pcmToWav(pcm));
  const events = [];
  const options = {
    paths,
    platform: 'darwin',
    delay: 3,
    gap: 2,
    repeat: 2,
    volume: 0.5,
    log: silentLog,
    play: async (path, volume) => events.push([path, volume]),
    wait: async (ms) => events.push(ms),
  };
  await playSamples(options);
  assert.deepEqual(events, [
    3000,
    [paths[0], 0.5],
    2000,
    [paths[1], 0.5],
    2000,
    [paths[0], 0.5],
    2000,
    [paths[1], 0.5],
    2000,
  ]);
  events.length = 0;
  await writeFile(paths[1], Buffer.from('invalid'));
  await assert.rejects(playSamples(options));
  assert.deepEqual(events, []);
});

test('invalid selection, playback options and platform fail early', async () => {
  assert.throws(() => selectSamples('../outside'));
  for (const overrides of [
    { platform: 'linux' },
    { repeat: 0 },
    { repeat: 1.5 },
    { gap: -1 },
    { volume: 2 },
    { delay: NaN },
  ])
    await assert.rejects(
      playSamples({ paths: ['missing.wav'], platform: 'darwin', ...overrides }),
      /macOS|옵션/,
    );
});

test('cancellation interrupts preparation delay without playing audio', async (t) => {
  const dir = await temp(t);
  const path = join(dir, 'one.wav');
  await writeFile(path, pcmToWav(pcm));
  const controller = new AbortController();
  const pending = playSamples({
    paths: [path],
    platform: 'darwin',
    delay: 60,
    signal: controller.signal,
    log: silentLog,
    play: async () => assert.fail('must not play'),
  });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
