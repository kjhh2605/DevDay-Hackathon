import { describe, expect, it } from 'vitest';
import { EnergyVad, PcmFramer, StreamingResampler } from './dsp.js';
import type { VadEvent } from './dsp.js';

function sine(rate: number, frequency: number, seconds = 1): Float32Array {
  return Float32Array.from(
    { length: Math.round(rate * seconds) },
    (_, index) => 0.8 * Math.sin((2 * Math.PI * frequency * index) / rate),
  );
}

function concatenate(chunks: Float32Array[]): Float32Array {
  const result = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function resample(input: Float32Array, rate: number, chunkSize = 128): Float32Array {
  const resampler = new StreamingResampler(rate);
  const chunks: Float32Array[] = [];
  for (let offset = 0; offset < input.length; offset += chunkSize) {
    chunks.push(resampler.push(input.subarray(offset, offset + chunkSize)));
  }
  chunks.push(resampler.flush());
  return concatenate(chunks);
}

function rms(input: Float32Array): number {
  return Math.sqrt(input.reduce((sum, value) => sum + value * value, 0) / input.length);
}

function pcm(length = 2_400, amplitude = 6_000): Int16Array {
  return new Int16Array(length).fill(amplitude);
}

function audio(events: VadEvent[]): Int16Array[] {
  return events.flatMap((event) => (event.type === 'frame' ? [event.pcm] : []));
}

describe('StreamingResampler', () => {
  it.each([44_100, 48_000])('preserves duration and a 1 kHz tone at %i Hz', (rate) => {
    const output = resample(sine(rate, 1_000), rate);
    expect(output).toHaveLength(24_000);
    const middle = output.subarray(64, output.length - 64);
    expect(rms(middle)).toBeCloseTo(0.8 / Math.sqrt(2), 3);
    const expected = sine(24_000, 1_000);
    const error = middle.map((value, index) => value - expected[index + 64]);
    expect(rms(error)).toBeLessThan(0.001);
  });

  it.each([44_100, 48_000])(
    'suppresses out-of-band audio before downsampling from %i Hz',
    (rate) => {
      const output = resample(sine(rate, 16_000), rate);
      // Direct sample picking aliases this signal to an audible 8 kHz tone.
      expect(rms(output.subarray(64, output.length - 64))).toBeLessThan(0.002);
    },
  );

  it('retains filter history across arbitrary chunk boundaries', () => {
    const input = sine(44_100, 3_251, 0.129);
    expect(resample(input, 44_100, 73)).toEqual(resample(input, 44_100, input.length));
  });

  it('drains short lookahead exactly once without adding duration', () => {
    const resampler = new StreamingResampler(48_000);
    expect(resampler.push(new Float32Array(13).fill(0.5))).toHaveLength(0);
    const tail = resampler.flush();
    expect(tail).toHaveLength(7);
    expect([...tail].every(Number.isFinite)).toBe(true);
    expect(resampler.flush()).toHaveLength(0);
    expect(() => resampler.push(new Float32Array(1))).toThrow(/after/);
  });

  it('copies same-rate input and accepts an empty stream', () => {
    const resampler = new StreamingResampler(24_000);
    const input = new Float32Array([0.1, 0.2]);
    expect(resampler.push(input)).toEqual(input);
    expect(resampler.push(input)).not.toBe(input);
    expect(resampler.flush()).toHaveLength(0);
    expect(new StreamingResampler(48_000).flush()).toHaveLength(0);
  });

  it('can be embedded as a self-contained AudioWorklet class', () => {
    const Resampler = new Function(
      `return (${StreamingResampler.toString()});`,
    )() as typeof StreamingResampler;
    const instance = new Resampler(48_000);
    expect(concatenate([instance.push(sine(48_000, 1_000, 0.01)), instance.flush()])).toHaveLength(
      240,
    );
  });
});

describe('PcmFramer', () => {
  it('clips safely to signed PCM16, handles invalid samples, and retains partial data', () => {
    const framer = new PcmFramer(5);
    expect(framer.push(new Float32Array([-2, -1, -0.5]))).toEqual([]);
    const [frame] = framer.push(new Float32Array([0, 0.5, 1, 2, NaN, Infinity, -Infinity]));
    expect([...frame]).toEqual([-32_768, -32_768, -16_384, 0, 16_384]);
    // The second full frame is emitted immediately too.
    expect(framer.flush()).toBeNull();
    expect(new PcmFramer(5).push(new Float32Array([1, 2, NaN, Infinity, -Infinity]))[0]).toEqual(
      new Int16Array([32_767, 32_767, 0, 32_767, -32_768]),
    );
  });

  it('emits 100 ms frames and drains a partial last frame only once', () => {
    const framer = new PcmFramer();
    const frames = framer.push(new Float32Array(4_801).fill(0.25));
    expect(frames.map((frame) => frame.length)).toEqual([2_400, 2_400]);
    expect(framer.flush()).toEqual(new Int16Array([8_192]));
    expect(framer.flush()).toBeNull();
    frames[0][0] = 0;
    expect(frames[1][0]).toBe(8_192);
  });

  it('can be embedded without external runtime dependencies', () => {
    const Framer = new Function(`return (${PcmFramer.toString()});`)() as typeof PcmFramer;
    expect(new Framer(1).push(new Float32Array([1]))[0][0]).toBe(32_767);
  });
});

describe('EnergyVad', () => {
  it('sends exactly 200 ms of pre-roll before the first voiced frame', () => {
    const vad = new EnergyVad();
    expect(vad.push(pcm(2_400, 0))).toEqual([]);
    expect(vad.push(pcm(2_400, 1))).toEqual([]);
    expect(vad.push(pcm(2_400, 2))).toEqual([]);
    const events = vad.push(pcm());
    expect(events.map((event) => event.type)).toEqual(['start', 'frame', 'frame', 'frame']);
    expect(events[0]).toEqual({ type: 'start', sampleOffset: 2_400 });
    expect(audio(events).map((frame) => frame[0])).toEqual([1, 2, 6_000]);
  });

  it('commits after 700 ms of silence and resets the timer when speech resumes', () => {
    const vad = new EnergyVad();
    vad.push(pcm());
    for (let index = 0; index < 6; index++) {
      expect(vad.push(pcm(2_400, 0)).map((event) => event.type)).toEqual(['frame']);
    }
    vad.push(pcm());
    for (let index = 0; index < 6; index++) {
      expect(vad.push(pcm(2_400, 0)).map((event) => event.type)).toEqual(['frame']);
    }
    expect(vad.push(pcm(2_400, 0)).map((event) => event.type)).toEqual(['frame', 'commit']);
    expect(vad.flush()).toEqual([]);
  });

  it('flushes a last short utterance once and discards idle silence', () => {
    const vad = new EnergyVad({ minSpeechMs: 0 });
    expect(vad.push(pcm(73)).map((event) => event.type)).toEqual(['start', 'frame']);
    expect(vad.flush()).toEqual([{ type: 'commit', lastVoicedSample: 73 }]);
    expect(vad.flush()).toEqual([]);
    vad.push(pcm(100, 0));
    expect(vad.flush()).toEqual([]);
    expect(audio(vad.push(pcm(31)))).toHaveLength(1);
  });

  it('splits uninterrupted speech every 20 seconds without dropping or duplicating samples', () => {
    const vad = new EnergyVad();
    const events: VadEvent[] = [];
    for (let index = 0; index < 403; index++) events.push(...vad.push(pcm()));
    events.push(...vad.flush());
    expect(events.filter((event) => event.type === 'start')).toHaveLength(3);
    expect(
      events.filter((event) => event.type === 'start').map((event) => event.sampleOffset),
    ).toEqual([0, 480_000, 960_000]);
    expect(events.filter((event) => event.type === 'commit')).toHaveLength(3);
    const lengths: number[] = [];
    let count = 0;
    for (const event of events) {
      if (event.type === 'frame') count += event.pcm.length;
      if (event.type === 'commit') {
        lengths.push(count);
        count = 0;
      }
    }
    expect(lengths).toEqual([480_000, 480_000, 7_200]);
  });

  it('uses sample counts for partial pre-roll, silence, and oversized input frames', () => {
    const vad = new EnergyVad({
      sampleRate: 1_000,
      minSpeechMs: 0,
      preRollMs: 20,
      silenceMs: 30,
      maxSegmentMs: 100,
    });
    vad.push(pcm(13, 1));
    vad.push(pcm(13, 2));
    const first = vad.push(pcm(190));
    expect(audio(first).map((frame) => frame.length)).toEqual([7, 13, 80, 100, 10]);
    expect(
      first.filter((event) => event.type === 'start').map((event) => event.sampleOffset),
    ).toEqual([6, 106, 206]);
    expect(first.filter((event) => event.type === 'commit')).toHaveLength(2);
    const silence = vad.push(pcm(40, 0));
    expect(audio(silence).map((frame) => frame.length)).toEqual([30]);
    expect(silence.at(-1)).toEqual({ type: 'commit', lastVoicedSample: 10 });
    const resumed = vad.push(pcm(1));
    expect(audio(resumed).map((frame) => frame.length)).toEqual([10, 1]);
    expect(resumed[0]).toEqual({ type: 'start', sampleOffset: 246 });
  });

  it('reset removes speech and buffered silence', () => {
    const vad = new EnergyVad();
    vad.push(pcm());
    vad.reset();
    expect(vad.flush()).toEqual([]);
    vad.push(pcm(2_400, 0));
    vad.reset();
    const restarted = vad.push(pcm());
    expect(audio(restarted)).toHaveLength(1);
    expect(restarted[0]).toEqual({ type: 'start', sampleOffset: 0 });
  });
});

it('creates no VAD rows during five minutes of silence and preserves a short answer after a click', () => {
  const vad = new EnergyVad();
  for (let i = 0; i < 3000; i++) expect(vad.push(pcm(2400, 0))).toEqual([]);
  expect(vad.push(pcm(240))).toEqual([]); // 10 ms impulse is too short to start speech.
  expect(vad.push(pcm(2400, 0))).toEqual([]);
  const answer = vad.push(pcm(2400)); // A 100 ms yes/no remains valid.
  expect(answer.some((e) => e.type === 'start')).toBe(true);
  expect(
    answer.filter((e) => e.type === 'frame').reduce((n, e) => n + e.pcm.length, 0),
  ).toBeGreaterThanOrEqual(2400);
});
