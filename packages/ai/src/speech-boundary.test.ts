import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpeechBoundary } from './speech-boundary.js';

afterEach(() => vi.useRealTimers());
describe('speech boundary uses last voiced sample, not commit time', () => {
  it('freezes exactly once at 10 seconds even if decision never returns', async () => {
    vi.useFakeTimers();
    const freeze = vi.fn();
    const b = new SpeechBoundary({ decide: () => new Promise(() => {}), freeze });
    b.start();
    b.end(700);
    b.text('I participated in', 1);
    await vi.advanceTimersByTimeAsync(9_299);
    expect(freeze).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(freeze).toHaveBeenCalledExactlyOnceWith('silence_timeout');
    b.close('mic_off');
    expect(freeze).toHaveBeenCalledTimes(1);
  });
  it('invalidates a decision on resumed activity before the text changes', async () => {
    vi.useFakeTimers();
    let resolve!: (v: { choice: 'complete'; confidence: number }) => void;
    const freeze = vi.fn();
    const decide = vi.fn(
      () =>
        new Promise<{ choice: 'complete'; confidence: number }>((r) => {
          resolve = r;
        }),
    );
    const b = new SpeechBoundary({ decide, freeze });
    b.start();
    b.end(0);
    b.text('I participated', 1);
    await vi.advanceTimersByTimeAsync(1_000);
    b.start();
    resolve({ choice: 'complete', confidence: 1 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(freeze).not.toHaveBeenCalled();
    b.end(0);
    b.text('I participated in a hackathon.', 2);
    await vi.advanceTimersByTimeAsync(1_000);
    resolve({ choice: 'complete', confidence: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(freeze).toHaveBeenCalledExactlyOnceWith('decision_complete');
  });
  it('does not classify the same revision repeatedly or classify blank speech', async () => {
    vi.useFakeTimers();
    const decide = vi.fn(async () => ({ choice: 'continue' as const, confidence: 1 }));
    const b = new SpeechBoundary({ decide, freeze: vi.fn() });
    b.start();
    b.end(0);
    b.text('   ', 1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(decide).not.toHaveBeenCalled();
    b.text('I went to', 2);
    await vi.advanceTimersByTimeAsync(8_999);
    expect(decide).toHaveBeenCalledTimes(1);
    b.dispose();
  });
});

it('restarts the deadline when speech resumes at nine seconds', async () => {
  vi.useFakeTimers();
  const freeze = vi.fn();
  const b = new SpeechBoundary({
    decide: async () => ({ choice: 'continue', confidence: 1 }),
    freeze,
  });
  b.start();
  b.end(0);
  b.text('I went to', 1);
  await vi.advanceTimersByTimeAsync(9000);
  b.start();
  await vi.advanceTimersByTimeAsync(2000);
  expect(freeze).not.toHaveBeenCalled();
  b.end(700);
  b.text('I went to a park', 2);
  await vi.advanceTimersByTimeAsync(9299);
  expect(freeze).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(freeze).toHaveBeenCalledTimes(1);
});
it('freezes membership on time before late final text is available', async () => {
  vi.useFakeTimers();
  const freeze = vi.fn(),
    decide = vi.fn(async () => ({ choice: 'complete' as const, confidence: 1 }));
  const b = new SpeechBoundary({ decide, freeze });
  b.start();
  b.end(0);
  await vi.advanceTimersByTimeAsync(10000);
  b.text('Late transcript.', 1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(freeze).toHaveBeenCalledExactlyOnceWith('silence_timeout');
  expect(decide).not.toHaveBeenCalled();
});
