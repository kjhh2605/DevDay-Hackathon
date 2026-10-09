import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import type { ApplicationPorts } from '@devday/application-ports';
import type { AudioServerMessage, TranscriptSegment } from '@devday/contracts';
import { MockAiProvider } from './mock-provider.js';
import { SpeechService } from './speech.js';
import type { RealtimeHandlers } from './provider.js';

function harness(provider = new MockAiProvider({ transcript: 'I goed there. human.' })) {
  const topicId = randomUUID(),
    studyId = randomUUID(),
    userId = randomUUID();
  const stored = new Map<string, TranscriptSegment>();
  const events: { type: string; payload: unknown }[] = [];
  const messages: AudioServerMessage[] = [];
  const ports = {
    studies: {
      getForTopic: async () => ({
        study: { id: studyId },
        topic: { id: topicId, state: 'talking', content: null },
      }),
    },
    speech: {
      begin: vi.fn(async (_actor, input) => {
        const segment: TranscriptSegment = {
          id: randomUUID(),
          revision: 0,
          studyId,
          topicId,
          speakerUserId: userId,
          startOrder: stored.size,
          startedAt: input.startedAt,
          endedAt: null,
          rawText: null,
          rawStatus: 'running',
          correctedText: null,
          correctionStatus: 'pending',
          sentenceStatus: 'pending',
        };
        stored.set(segment.id, segment);
        return { ...segment };
      }),
      completeRaw: vi.fn(async (id: string, input: { text: string; endedAt: string }) => {
        const next: TranscriptSegment = {
          ...stored.get(id)!,
          rawText: input.text,
          endedAt: input.endedAt,
          rawStatus: 'ready',
          revision: stored.get(id)!.revision + 1,
        };
        stored.set(id, next);
        return { ...next };
      }),
      applyCorrection: vi.fn(
        async (id: string, input: { text: string; expectedRevision: number }) => {
          const current = stored.get(id)!;
          if (input.expectedRevision !== current.revision) return null;
          const next: TranscriptSegment = {
            ...current,
            correctionStatus: 'ready',
            correctedText: input.text,
            revision: current.revision + 1,
          };
          stored.set(id, next);
          return { ...next };
        },
      ),
      fail: vi.fn(async (id: string, phase: 'raw' | 'correction') => {
        const current = stored.get(id)!;
        stored.set(id, {
          ...current,
          ...(phase === 'raw' ? { rawStatus: 'failed' } : { correctionStatus: 'failed' }),
          revision: current.revision + 1,
        });
      }),
      listSegments: async () => [...stored.values()],
    },
    media: { put: vi.fn(async (_input: { bytes: Uint8Array }) => ({ mediaId: randomUUID() })) },
    events: {
      toStudy: async (_id: string, event: { type: string; payload: unknown }) => {
        events.push(event);
      },
      toUser: async (_id: string, event: { type: string; payload: unknown }) => {
        events.push(event);
      },
    },
  };
  const service = new SpeechService(ports as unknown as ApplicationPorts, provider);
  const connection = service.createConnection({ userId }, (message) => messages.push(message));
  async function start() {
    await connection.receive({
      type: 'audio.start',
      topicId,
      clientStreamId: randomUUID(),
      format: 'pcm16',
      sampleRate: 24_000,
      channels: 1,
    });
    const ready = messages.find((message) => message.type === 'audio.ready');
    if (!ready || ready.type !== 'audio.ready') throw new Error('not ready');
    return ready.streamId;
  }
  async function segment(streamId: string) {
    const clientSegmentId = randomUUID();
    await connection.receive({ type: 'audio.segment_start', streamId, clientSegmentId });
    await connection.receive({
      type: 'audio.chunk',
      streamId,
      clientSegmentId,
      seq: 0,
      pcmBase64: Buffer.alloc(4800).toString('base64'),
    });
    await connection.receive({
      type: 'audio.segment_commit',
      streamId,
      clientSegmentId,
      lastSeq: 0,
    });
    return [...stored.values()].at(-1)!;
  }
  return { ...ports, service, connection, messages, events, stored, topicId, start, segment };
}

describe('speech persistence and flush', () => {
  it('waits for raw and same-PCM correction before flush and preserves a final word', async () => {
    const provider = new MockAiProvider({ transcript: 'I goed there. human.' });
    let release!: (text: string) => void;
    const correction = new Promise<string>((resolve) => {
      release = resolve;
    });
    vi.spyOn(provider, 'transcribe').mockReturnValue(correction);
    const h = harness(provider);
    const streamId = await h.start();
    const segment = await h.segment(streamId);
    await vi.waitFor(() => expect(h.stored.get(segment.id)?.rawStatus).toBe('ready'));
    const closeId = randomUUID();
    const close = h.service.flushTopic(h.topicId, closeId);
    await vi.waitFor(() =>
      expect(h.events.some((event) => event.type === 'audio.flush_requested')).toBe(true),
    );
    const flush = h.connection.receive({
      type: 'audio.flush',
      streamId,
      closeId,
      lastSegmentId: segment.id,
      lastSeq: 0,
    });
    expect(h.messages.some((message) => message.type === 'audio.flushed')).toBe(false);
    release('I goed there. human.');
    await flush;
    await close;
    expect(h.stored.get(segment.id)).toMatchObject({
      rawText: 'I goed there. human.',
      correctedText: 'I goed there. human.',
      correctionStatus: 'ready',
    });
    expect(h.messages.some((message) => message.type === 'audio.flushed')).toBe(true);
    const media = h.media.put.mock.calls[0]?.[0] as unknown as { bytes: Uint8Array } | undefined;
    // Real media payload is a valid WAV made from exactly the captured PCM.
    expect(media && Buffer.from(media.bytes).subarray(0, 4).toString()).toBe('RIFF');
    await expect(
      h.connection.receive({
        type: 'audio.chunk',
        streamId,
        clientSegmentId: randomUUID(),
        seq: 0,
        pcmBase64: 'AAA=',
      }),
    ).rejects.toThrow('INPUT_CLOSED');
    h.service.shutdown();
  });
  it('rejects missing sequences and false final acknowledgements', async () => {
    const h = harness();
    const streamId = await h.start();
    const clientSegmentId = randomUUID();
    await h.connection.receive({ type: 'audio.segment_start', streamId, clientSegmentId });
    await expect(
      h.connection.receive({
        type: 'audio.chunk',
        streamId,
        clientSegmentId,
        seq: 1,
        pcmBase64: 'AAA=',
      }),
    ).rejects.toThrow('AUDIO_SEQUENCE_GAP');
    await expect(
      h.connection.receive({ type: 'audio.segment_commit', streamId, clientSegmentId, lastSeq: 0 }),
    ).rejects.toThrow('INCOMPLETE_SEGMENT');
    h.connection.disconnect();
    h.service.shutdown();
  });
  it('retries a failed correction using retained PCM and the current failed revision', async () => {
    const provider = new MockAiProvider();
    const transcribe = vi
      .spyOn(provider, 'transcribe')
      .mockRejectedValueOnce(new Error('provider failed'))
      .mockResolvedValue('human');
    const h = harness(provider);
    const streamId = await h.start();
    const segment = await h.segment(streamId);
    await vi.waitFor(() => expect(h.stored.get(segment.id)?.correctionStatus).toBe('failed'));
    h.connection.disconnect();
    await h.service.flushTopic(h.topicId, randomUUID());
    expect(h.stored.get(segment.id)?.correctionStatus).toBe('ready');
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(h.speech.applyCorrection.mock.calls[0]?.[1].expectedRevision).toBe(2);
    h.service.shutdown();
  });
  it('explicit close retries failed raw from the retained committed PCM on a fresh connection', async () => {
    const provider = new MockAiProvider({ transcript: 'last human' });
    const realConnect = provider.connectTranscription.bind(provider);
    let attempt = 0;
    vi.spyOn(provider, 'connectTranscription').mockImplementation(
      async (handlers: RealtimeHandlers) => {
        attempt += 1;
        if (attempt > 1) return realConnect(handlers);
        return {
          append: () => undefined,
          commit: () => queueMicrotask(() => handlers.onError(new Error('interrupted'))),
          close: () => undefined,
        };
      },
    );
    const h = harness(provider);
    const streamId = await h.start();
    const segment = await h.segment(streamId);
    await vi.waitFor(() => expect(h.stored.get(segment.id)?.rawStatus).toBe('failed'));
    await h.service.flushTopic(h.topicId, randomUUID());
    expect(h.stored.get(segment.id)).toMatchObject({
      rawStatus: 'ready',
      rawText: 'last human',
      correctionStatus: 'ready',
    });
    expect(attempt).toBe(2);
    h.service.shutdown();
  });
});

describe('provider transcription quality guard', () => {
  it('fails visibly when mixed speech correction drops the whole English portion', async () => {
    const provider = new MockAiProvider({
      transcript: '어제 친구를 만났어요. Yesterday I go to a cafe. human.',
    });
    vi.spyOn(provider, 'transcribe').mockResolvedValue('어제 친구를 만났어요.');
    const h = harness(provider);
    const streamId = await h.start();
    const segment = await h.segment(streamId);
    await vi.waitFor(() => expect(h.stored.get(segment.id)?.correctionStatus).toBe('failed'));
    expect(h.speech.applyCorrection).not.toHaveBeenCalled();
    expect(h.stored.get(segment.id)?.rawText).toContain('I go');
    h.service.shutdown();
  });
  it('rotates a healthy provider between segments before its session lifetime ends', async () => {
    const provider = new MockAiProvider();
    const connect = vi.spyOn(provider, 'connectTranscription');
    const h = harness(provider);
    const streamId = await h.start();
    const first = await h.segment(streamId);
    await vi.waitFor(() => expect(h.stored.get(first.id)?.correctionStatus).toBe('ready'));
    const originalNow = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(originalNow + 56 * 60_000);
    try {
      const second = await h.segment(streamId);
      await vi.waitFor(() => expect(h.stored.get(second.id)?.correctionStatus).toBe('ready'));
      expect(connect).toHaveBeenCalledTimes(2);
      expect(h.messages.filter((message) => message.type === 'audio.error')).toHaveLength(0);
    } finally {
      clock.mockRestore();
      h.service.shutdown();
    }
  });
});

describe('explicit microphone stop', () => {
  it('finishes already committed audio after the browser closes its stopped socket', async () => {
    const provider = new MockAiProvider();
    let release!: (text: string) => void;
    vi.spyOn(provider, 'transcribe').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const h = harness(provider);
    const streamId = await h.start();
    const segment = await h.segment(streamId);
    await vi.waitFor(() => expect(release).toBeDefined());
    const stopped = h.connection.receive({ type: 'audio.stop', streamId });
    h.connection.disconnect(); // Browser releases device and closes socket without waiting for AI.
    release('human');
    await stopped;
    expect(h.stored.get(segment.id)?.correctionStatus).toBe('ready');
    expect(h.speech.fail).not.toHaveBeenCalled();
    await h.service.flushTopic(h.topicId, randomUUID());
    h.service.shutdown();
  });
});
