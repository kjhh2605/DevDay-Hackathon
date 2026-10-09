import { describe, expect, it, vi } from 'vitest';
import { createCaptureController } from './controller.js';
import type { CaptureSource } from './browser-source.js';
import { CaptureError, microphoneError } from './types.js';

class Source implements CaptureSource {
  callback: ((pcm: Int16Array) => void) | null = null;
  tail: Int16Array | null = null;
  prepare = vi.fn(async () => {});
  release = vi.fn(async () => {
    this.callback = null;
  });
  async start(callback: (pcm: Int16Array) => void) {
    this.callback = callback;
  }
  async flush() {
    if (this.tail) this.callback?.(this.tail);
    this.callback = null;
  }
  frame(pcm: Int16Array) {
    this.callback?.(pcm);
  }
}

function setup(now?: () => number) {
  const source = new Source();
  const events: string[] = [];
  const frames: Int16Array[] = [];
  const transport = {
    connect: vi.fn(async () => {
      events.push('connect');
    }),
    beginSegment: vi.fn((_startedAt?: string) => {
      events.push('begin');
    }),
    append: vi.fn((pcm: Int16Array) => {
      frames.push(pcm);
      events.push('frame');
    }),
    commit: vi.fn(() => {
      events.push('commit');
    }),
    drain: vi.fn(async () => {
      events.push('drain');
    }),
    flush: vi.fn(async () => {
      events.push('flush');
    }),
    stop: vi.fn(() => {
      events.push('stop');
    }),
    close: vi.fn(),
  };
  const onState = vi.fn();
  const controller = createCaptureController(
    { onState },
    { sourceFactory: () => source, transportFactory: () => transport, now },
  );
  return { controller, source, transport, events, frames, onState };
}

describe('capture lifecycle', () => {
  it('timestamps captured samples including pre-roll without using delayed frame delivery time', async () => {
    const start = Date.parse('2026-10-09T01:02:03.000Z');
    let clock = start;
    const { controller, source, transport } = setup(() => clock);
    await controller.startCapture('topic');
    // 300 ms captured silence retains the most recent 200 ms as pre-roll.
    for (let index = 0; index < 3; index++) source.frame(new Int16Array(2400));
    clock += 10_000; // Main-thread/network latency must not shift capture time.
    source.frame(new Int16Array(2400).fill(4000));
    expect(transport.beginSegment).toHaveBeenCalledWith('2026-10-09T01:02:03.100Z');
    await controller.stopCapture();
  });

  it('flushes the last partial word before the server flush and ignores review audio', async () => {
    const { controller, source, transport, events, frames } = setup();
    await controller.startCapture('topic-one');
    source.frame(new Int16Array(2400).fill(3000));
    source.tail = new Int16Array(1200).fill(4000);
    await controller.flush('close-one');
    expect(events).toEqual(['connect', 'begin', 'frame', 'frame', 'commit', 'flush']);
    expect(frames.reduce((count, pcm) => count + pcm.length, 0)).toBe(3600);
    expect(frames.at(-1)![1199]).toBe(4000);
    expect(controller.getState().status).toBe('stopped');
    expect(source.release).not.toHaveBeenCalled();
    source.frame(new Int16Array(2400).fill(9000));
    expect(transport.append).toHaveBeenCalledTimes(2);
    await controller.flush('close-one');
    expect(transport.flush).toHaveBeenCalledOnce();
  });

  it('restarts a new topic with no review pre-roll and releases mic on explicit stop', async () => {
    const { controller, source, frames, transport } = setup();
    await controller.startCapture('topic-one');
    source.frame(new Int16Array(2400));
    await controller.flush('close-one');
    source.frame(new Int16Array(2400).fill(10000));
    await controller.startCapture('topic-two');
    source.frame(new Int16Array(2400).fill(4000));
    await controller.stopCapture();
    expect(frames).toHaveLength(1);
    expect(frames[0]![0]).toBe(4000);
    expect(transport.connect.mock.calls).toHaveLength(2);
    expect(source.release).toHaveBeenCalledOnce();
    expect(transport.drain).toHaveBeenCalledOnce();
    expect(transport.stop).toHaveBeenCalledOnce();
  });

  it('surfaces microphone permission denial without opening a connection', async () => {
    const { controller, source, transport } = setup();
    source.prepare.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    await expect(controller.startCapture('topic')).rejects.toMatchObject({
      code: 'microphone_permission_denied',
    });
    expect(controller.getState()).toMatchObject({
      status: 'error',
      error: { code: 'microphone_permission_denied' },
    });
    expect(transport.connect).not.toHaveBeenCalled();
  });

  it('shows provider failures separately and releases the physical microphone', async () => {
    const { controller, source, transport } = setup();
    await controller.startCapture('topic');
    transport.flush.mockRejectedValueOnce(new CaptureError('provider_failed', 'OpenAI failed'));
    await expect(controller.flush('close')).rejects.toMatchObject({ code: 'provider_failed' });
    expect(source.release).toHaveBeenCalledOnce();
    expect(controller.getState().error?.code).toBe('provider_failed');
  });

  it('deduplicates start and stop calls and prevents overlapping topic captures', async () => {
    const { controller, source, transport } = setup();
    const first = controller.startCapture('topic');
    const second = controller.startCapture('topic');
    expect(second).toBe(first);
    await first;
    await controller.startCapture('topic');
    expect(transport.connect).toHaveBeenCalledOnce();
    await expect(controller.startCapture('other')).rejects.toMatchObject({
      code: 'protocol_error',
    });
    await Promise.all([controller.stopCapture(), controller.stopCapture()]);
    expect(source.release).toHaveBeenCalledOnce();
  });

  it('differentiates absent devices and busy devices', () => {
    expect(microphoneError(new DOMException('missing', 'NotFoundError')).code).toBe(
      'microphone_not_found',
    );
    expect(microphoneError(new DOMException('busy', 'NotReadableError')).code).toBe(
      'microphone_unavailable',
    );
  });

  it('allows explicit stop during close without cancelling the final worklet frame', async () => {
    const { controller, source, transport, frames } = setup();
    let finishSource!: () => void;
    source.flush = () =>
      new Promise<void>((resolve) => {
        finishSource = () => {
          source.frame(new Int16Array(600).fill(7000));
          source.callback = null;
          resolve();
        };
      });
    let finishServer!: () => void;
    transport.flush.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishServer = resolve;
        }),
    );
    await controller.startCapture('topic');
    source.frame(new Int16Array(2400).fill(4000));
    const closing = controller.flush('close');
    const stopping = controller.stopCapture();
    expect(source.release).not.toHaveBeenCalled();
    finishSource();
    await vi.waitFor(() => expect(transport.flush).toHaveBeenCalledOnce());
    expect(frames.at(-1)).toHaveLength(600);
    expect(source.release).toHaveBeenCalledOnce();
    finishServer();
    await Promise.all([closing, stopping]);
    expect(controller.getState().status).toBe('stopped');
  });
});
