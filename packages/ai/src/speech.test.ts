import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ApplicationPorts } from '@devday/application-ports';
import type { AudioServerMessage, TranscriptSegment, SpeechGroup } from '@devday/contracts';
import { MockAiProvider } from './mock-provider.js';
import { SpeechService } from './speech.js';
import type { RealtimeHandlers } from './provider.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const waitFor = (fn: () => unknown) => vi.waitFor(fn, { timeout: 3500 });

function harness(provider = new MockAiProvider({ transcript: 'I goed there. human.' })) {
  const topicId = randomUUID(),
    studyId = randomUUID(),
    userId = randomUUID();
  const stored = new Map<string, TranscriptSegment>();
  const groups = new Map<string, SpeechGroup>();
  const audio = new Map<string, Uint8Array>();
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
      listGroups: async () => [...groups.values()],
      saveGroup: vi.fn(async (group: SpeechGroup, expected: number | null) => {
        if (expected === null ? groups.has(group.id) : groups.get(group.id)?.revision !== expected)
          return false;
        groups.set(group.id, structuredClone(group));
        for (const id of group.segmentIds) {
          const segment = stored.get(id)!;
          stored.set(id, {
            ...segment,
            groupId: group.id,
            correctionStatus:
              group.state === 'failed'
                ? 'failed'
                : ['ready', 'no_speech'].includes(group.state)
                  ? 'ready'
                  : 'pending',
          });
        }
        return true;
      }),
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
    media: {
      put: vi.fn(async (input: { bytes: Uint8Array; segmentId: string }) => {
        audio.set(input.segmentId, input.bytes);
        return { mediaId: randomUUID() };
      }),
      readSegmentAudio: async (id: string) => audio.get(id)!,
    },
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
  const clientStreamId = randomUUID();
  async function start() {
    await connection.receive({
      type: 'audio.start',
      topicId,
      clientStreamId,
      format: 'pcm16',
      sampleRate: 24_000,
      channels: 1,
    });
    const ready = messages.find((message) => message.type === 'audio.ready');
    if (!ready || ready.type !== 'audio.ready') throw new Error('not ready');
    return ready.streamId;
  }
  async function segment(streamId: string, bytes = 4800) {
    const clientSegmentId = randomUUID();
    await connection.receive({ type: 'audio.segment_start', streamId, clientSegmentId });
    for (let offset = 0; offset < bytes; offset += 48000)
      await connection.receive({
        type: 'audio.chunk',
        streamId,
        clientSegmentId,
        seq: offset / 48000,
        pcmBase64: Buffer.alloc(Math.min(48000, bytes - offset)).toString('base64'),
      });
    await connection.receive({
      type: 'audio.segment_commit',
      streamId,
      clientSegmentId,
      lastSeq: Math.ceil(bytes / 48000) - 1,
    });
    return [...stored.values()].at(-1)!;
  }
  return {
    ...ports,
    userId,
    clientStreamId,
    groups,
    service,
    connection,
    messages,
    events,
    stored,
    topicId,
    start,
    segment,
  };
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
    await waitFor(() => expect(h.stored.get(segment.id)?.rawStatus).toBe('ready'));
    const closeId = randomUUID();
    const close = h.service.flushTopic(h.topicId, closeId);
    await waitFor(() =>
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

      correctionStatus: 'ready',
    });
    expect([...h.groups.values()][0]?.correctedText).toBe('I goed there. human.');
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
    const provider = new MockAiProvider({ transcript: 'I really One 저거 어떤 concept' });
    const transcribe = vi
      .spyOn(provider, 'transcribe')
      .mockRejectedValueOnce(new Error('provider failed'))
      .mockResolvedValue('I really want to go that concert.');
    const h = harness(provider);
    const streamId = await h.start();
    const segment = await h.segment(streamId);
    await waitFor(() => expect(h.stored.get(segment.id)?.correctionStatus).toBe('failed'));
    await h.connection.receive({ type: 'audio.stop', streamId });
    await h.service.flushTopic(h.topicId, randomUUID());
    expect(h.stored.get(segment.id)?.correctionStatus).toBe('ready');
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect([...h.groups.values()][0]).toMatchObject({
      state: 'ready',
      correctedText: 'I really want to go that concert.',
    });
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
    await waitFor(() => expect(h.stored.get(segment.id)?.rawStatus).toBe('failed'));
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

describe('provider transcription results', () => {
  it.each(['어제 친구를 만났어요.', 'I really want to go that concert.', ''])(
    'accepts correction output unchanged: %j',
    async (correctedText) => {
      const provider = new MockAiProvider({
        transcript: 'I really One 저거 어떤 concept',
      });
      vi.spyOn(provider, 'transcribe').mockResolvedValue(correctedText);
      const h = harness(provider);
      const streamId = await h.start();
      const segment = await h.segment(streamId);
      await waitFor(() => expect(h.stored.get(segment.id)?.correctionStatus).toBe('ready'));
      expect([...h.groups.values()][0]).toMatchObject({ state: 'ready', correctedText });
      expect(h.stored.get(segment.id)?.rawText).toBe('I really One 저거 어떤 concept');
      h.service.shutdown();
    },
  );
  it('rotates a healthy provider between segments before its session lifetime ends', async () => {
    const provider = new MockAiProvider();
    const connect = vi.spyOn(provider, 'connectTranscription');
    const h = harness(provider);
    const streamId = await h.start();
    const first = await h.segment(streamId);
    await waitFor(() => expect(h.stored.get(first.id)?.correctionStatus).toBe('ready'));
    const originalNow = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(originalNow + 56 * 60_000);
    try {
      const second = await h.segment(streamId);
      await waitFor(() => expect(h.stored.get(second.id)?.correctionStatus).toBe('ready'));
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
    await waitFor(() => expect(release).toBeDefined());
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

describe('persistent speech groups', () => {
  it('keeps a silent stream open for five minutes without creating work', async () => {
    const provider = new MockAiProvider();
    const decide = vi.spyOn(provider, 'decideSpeech'),
      transcribe = vi.spyOn(provider, 'transcribe');
    const h = harness(provider);
    await h.start();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(h.stored.size).toBe(0);
    expect(h.groups.size).toBe(0);
    expect(decide).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    expect(h.messages.filter((m) => m.type === 'audio.error')).toHaveLength(0);
    h.service.shutdown();
  });
  it('accumulates three interrupted parts and corrects their ordered PCM once', async () => {
    const provider = new MockAiProvider();
    const parts = ['I participated', 'in a hackathon', 'last weekend.'];
    let i = 0;
    vi.spyOn(provider, 'connectTranscription').mockImplementation(async (handlers) => ({
      append: () => {},
      close: () => {},
      commit: () => {
        const item_id = randomUUID(),
          transcript = parts[i++]!;
        queueMicrotask(() => {
          handlers.onEvent({ type: 'input_audio_buffer.committed', item_id });
          handlers.onEvent({
            type: 'conversation.item.input_audio_transcription.completed',
            item_id,
            transcript,
          });
        });
      },
    }));
    const decide = vi
      .spyOn(provider, 'decideSpeech')
      .mockResolvedValueOnce({ choice: 'continue', confidence: 1 } as never)
      .mockResolvedValueOnce({ choice: 'uncertain', confidence: 0.7 } as never)
      .mockResolvedValue({ choice: 'complete', confidence: 0.99 });
    const transcribe = vi
      .spyOn(provider, 'transcribe')
      .mockResolvedValue('I participated in a hackathon last weekend.');
    const h = harness(provider),
      streamId = await h.start();
    for (let part = 0; part < 3; part++) {
      await h.segment(streamId);
      await vi.advanceTimersByTimeAsync(1500);
    }
    expect(h.groups.size).toBe(1);
    const group = [...h.groups.values()][0]!;
    expect(group.state).toBe('ready');
    expect(group.rawText).toBe(parts.join('\n'));
    expect(group.segmentIds).toHaveLength(3);
    expect(decide).toHaveBeenCalledTimes(3);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe.mock.calls[0]![0]).toHaveLength(3 * 4800);
    expect([...h.stored.values()].every((s) => s.correctedText === null)).toBe(true);
    h.service.shutdown();
  });
  it('treats a blank successful transcript as no_speech and skips decisions/correction', async () => {
    const provider = new MockAiProvider({ transcript: '  ' });
    const decide = vi.spyOn(provider, 'decideSpeech'),
      transcribe = vi.spyOn(provider, 'transcribe');
    const h = harness(provider),
      streamId = await h.start();
    await h.segment(streamId);
    await h.connection.receive({ type: 'audio.stop', streamId });
    expect([...h.groups.values()][0]?.state).toBe('no_speech');
    expect(decide).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    await h.service.flushTopic(h.topicId, randomUUID());
    h.service.shutdown();
  });
  it('isolates a correction failure and continues processing on the same connection', async () => {
    const provider = new MockAiProvider({ transcript: 'Yes.' });
    vi.spyOn(provider, 'transcribe')
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValue('Yes.');
    const h = harness(provider),
      streamId = await h.start();
    await h.segment(streamId);
    await vi.advanceTimersByTimeAsync(1500);
    await h.segment(streamId);
    await vi.advanceTimersByTimeAsync(1500);
    expect([...h.groups.values()].map((g) => g.state)).toEqual(['failed', 'ready']);
    expect(h.messages.some((m) => m.type === 'audio.processing_error')).toBe(true);
    expect(h.messages.some((m) => m.type === 'audio.error')).toBe(false);
    h.service.shutdown();
  });
});

it('persists an interrupted uncommitted segment as failed, never as no_speech', async () => {
  const h = harness(),
    streamId = await h.start(),
    clientSegmentId = randomUUID();
  await h.connection.receive({ type: 'audio.segment_start', streamId, clientSegmentId });
  await h.connection.receive({
    type: 'audio.chunk',
    streamId,
    clientSegmentId,
    seq: 0,
    pcmBase64: Buffer.alloc(4800).toString('base64'),
  });
  h.connection.disconnect();
  await vi.advanceTimersByTimeAsync(15000);
  expect([...h.groups.values()][0]?.state).toBe('failed');
  expect([...h.stored.values()][0]?.rawStatus).toBe('failed');
  await h.service.flushTopic(h.topicId, randomUUID());
  expect([...h.groups.values()][0]?.state).toBe('ready');
  h.service.shutdown();
});

it('deduplicates acknowledged and unacknowledged segment chunks on a resumed server stream', async () => {
  const provider = new MockAiProvider({ transcript: 'Yes.' });
  const transcribe = vi.spyOn(provider, 'transcribe');
  const h = harness(provider),
    streamId = await h.start(),
    clientSegmentId = randomUUID();
  const chunk = {
    type: 'audio.chunk',
    streamId,
    clientSegmentId,
    seq: 0,
    pcmBase64: Buffer.alloc(4800).toString('base64'),
  };
  await h.connection.receive({ type: 'audio.segment_start', streamId, clientSegmentId });
  await h.connection.receive(chunk);
  h.connection.disconnect();
  const next = h.service.createConnection({ userId: h.userId }, (message) =>
    h.messages.push(message),
  );
  await next.receive({
    type: 'audio.start',
    topicId: h.topicId,
    clientStreamId: h.clientStreamId,
    resumeStreamId: streamId,
    format: 'pcm16',
    sampleRate: 24000,
    channels: 1,
  });
  await next.receive({ type: 'audio.segment_start', streamId, clientSegmentId });
  await next.receive(chunk);
  await next.receive({ ...chunk, seq: 1 });
  await expect(h.connection.receive(chunk)).rejects.toThrow('SUPERSEDED_CONNECTION');
  await next.receive({ type: 'audio.segment_commit', streamId, clientSegmentId, lastSeq: 1 });
  await next.receive({ type: 'audio.stop', streamId });
  expect(h.speech.begin).toHaveBeenCalledTimes(1);
  expect(h.media.put).toHaveBeenCalledTimes(1);
  expect(transcribe.mock.calls[0]![0]).toHaveLength(9600);
  expect([...h.groups.values()][0]?.state).toBe('ready');
  h.service.shutdown();
});

it('waits for the first raw result when final transcriptions arrive in reverse order', async () => {
  const provider = new MockAiProvider();
  const finals: (() => void)[] = [];
  vi.spyOn(provider, 'connectTranscription').mockImplementation(async (handlers) => ({
    append: () => {},
    close: () => {},
    commit: () => {
      const item_id = randomUUID(),
        index = finals.length;
      handlers.onEvent({ type: 'input_audio_buffer.committed', item_id });
      finals.push(() =>
        handlers.onEvent({
          type: 'conversation.item.input_audio_transcription.completed',
          item_id,
          transcript: index === 0 ? 'First' : 'second.',
        }),
      );
    },
  }));
  const decide = vi.spyOn(provider, 'decideSpeech');
  vi.spyOn(provider, 'transcribe').mockResolvedValue('First second.');
  const h = harness(provider),
    streamId = await h.start();
  await h.segment(streamId);
  await h.segment(streamId);
  finals[1]!();
  await vi.advanceTimersByTimeAsync(1500);
  expect(decide).not.toHaveBeenCalled();
  finals[0]!();
  await vi.advanceTimersByTimeAsync(100);
  expect(decide).toHaveBeenCalledTimes(1);
  expect([...h.groups.values()][0]).toMatchObject({ state: 'ready', rawText: 'First\nsecond.' });
  h.service.shutdown();
});

it('freezes at the 60-second PCM cap and sends subsequent audio to a new group', async () => {
  const provider = new MockAiProvider({ transcript: 'Yes.' });
  const transcribe = vi.spyOn(provider, 'transcribe');
  const h = harness(provider),
    streamId = await h.start();
  for (let i = 0; i < 3; i++) await h.segment(streamId, 20 * 48000);
  await vi.advanceTimersByTimeAsync(0);
  expect([...h.groups.values()][0]).toMatchObject({ state: 'ready', closeReason: 'size_limit' });
  expect(transcribe.mock.calls[0]![0]).toHaveLength(60 * 48000);
  await h.segment(streamId);
  expect(h.groups.size).toBe(2);
  await h.connection.receive({ type: 'audio.stop', streamId });
  h.service.shutdown();
});
