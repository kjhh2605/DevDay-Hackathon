import { describe, expect, it } from 'vitest';
import { captureWorkletSource } from './worklet.js';

describe('audio worklet module', () => {
  it('executes the actual standalone module, resamples hardware input, and flushes its final partial frame', () => {
    const messages: { type: string; pcm?: ArrayBuffer; requestId?: string }[] = [];
    class Processor {
      port = {
        onmessage: null as null | ((event: { data: { type: string; requestId?: string } }) => void),
        postMessage: (value: { type: string; pcm?: ArrayBuffer; requestId?: string }) =>
          messages.push(value),
      };
    }
    let constructor: (new () => Processor & { process(input: Float32Array[][]): boolean }) | null =
      null;
    const register = (_name: string, value: typeof constructor) => {
      constructor = value;
    };
    new Function(
      'AudioWorkletProcessor',
      'registerProcessor',
      'sampleRate',
      captureWorkletSource(),
    )(Processor, register, 48000);
    expect(constructor).not.toBeNull();
    const worklet = new constructor!();
    // Nothing is collected before explicit activation, or after flush during review.
    const tone = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 4) * 0.2);
    worklet.process([[tone]]);
    expect(messages).toHaveLength(0);
    worklet.port.onmessage!({ data: { type: 'start' } });
    for (let i = 0; i < 40; i++) worklet.process([[tone]]);
    worklet.port.onmessage!({ data: { type: 'flush', requestId: 'flush-one' } });
    const frames = messages
      .filter((message) => message.type === 'frame')
      .map((message) => new Int16Array(message.pcm!));
    expect(frames.map((frame) => frame.length)).toEqual([2400, 160]);
    expect(frames.some((frame) => frame.some((sample) => sample !== 0))).toBe(true);
    expect(messages.at(-1)).toEqual({ type: 'flushed', requestId: 'flush-one' });
    worklet.process([[tone]]);
    expect(messages).toHaveLength(3);
    // A new topic creates a fresh resampler and discards review-time samples.
    worklet.port.onmessage!({ data: { type: 'start' } });
    worklet.process([[new Float32Array(128)]]);
    worklet.port.onmessage!({ data: { type: 'flush', requestId: 'flush-two' } });
    const final = new Int16Array(messages.at(-2)!.pcm!);
    expect(final).toHaveLength(64);
    expect(final.every((sample) => sample === 0)).toBe(true);
  });
});
