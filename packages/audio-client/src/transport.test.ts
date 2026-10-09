import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioTransport, pcm16ToBase64 } from './transport.js';
import type { AudioSocket } from './transport.js';

const topicId = '3ba65a85-4067-42f9-a9ae-f7349ce1e8b4';
const streamId = 'cad5bdba-29ae-474a-99d3-c4fa1092d224';
const segmentId = 'f2772950-99fb-48e5-91c9-d53f627e5513';
const closeId = '4dc07756-4b98-46dc-be20-487f2cc93cb4';

class Socket implements AudioSocket {
  readyState = 0;
  bufferedAmount = 0;
  onopen: AudioSocket['onopen'] = null;
  onmessage: AudioSocket['onmessage'] = null;
  onerror: AudioSocket['onerror'] = null;
  onclose: AudioSocket['onclose'] = null;
  sent: Record<string, unknown>[] = [];
  autoAck = true;
  serverIds = new Map<string, string>();
  inspect: ((message: Record<string, unknown>) => void) | null = null;
  send(value: string) {
    const message = JSON.parse(value);
    this.inspect?.(message);
    this.sent.push(message);
    if (this.autoAck && message.type === 'audio.segment_commit')
      queueMicrotask(() =>
        this.receive({
          type: 'audio.segment_committed',
          clientSegmentId: message.clientSegmentId,
          segmentId: this.serverIds.get(message.clientSegmentId),
          lastSeq: message.lastSeq,
        }),
      );
  }
  close() {
    this.readyState = 3;
    this.onclose?.({});
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(value: unknown) {
    const msg = value as Record<string, string>;
    if (msg.type === 'audio.segment_ready')
      this.serverIds.set(msg.clientSegmentId!, msg.segmentId!);
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}

async function connected() {
  const socket = new Socket();
  const onFailure = vi.fn();
  const transport = new AudioTransport({
    url: 'ws://localhost/ws/audio',
    socketFactory: () => socket,
    onFailure,
  });
  const ready = transport.connect(topicId);
  socket.open();
  expect(socket.sent[0]).toMatchObject({
    type: 'audio.start',
    topicId,
    sampleRate: 24000,
    format: 'pcm16',
    channels: 1,
  });
  socket.receive({ type: 'audio.ready', streamId, topicId });
  await ready;
  return { transport, socket, onFailure };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('audio transport', () => {
  it('holds the first word until segment_ready, sends ordered chunks and commit before final flush', async () => {
    const { transport, socket, onFailure } = await connected();
    const capturedAt = '2026-10-09T01:02:03.100Z';
    transport.beginSegment(capturedAt);
    const clientSegmentId = socket.sent.at(-1)!.clientSegmentId;
    expect(socket.sent.at(-1)?.startedAt).toBe(capturedAt);
    transport.append(new Int16Array([7, -8]));
    transport.append(new Int16Array([9]));
    transport.commit();
    const flushed = transport.flush(closeId);
    expect(socket.sent.map((item) => item.type)).toEqual(['audio.start', 'audio.segment_start']);
    socket.receive({ type: 'audio.segment_ready', clientSegmentId, segmentId, startOrder: 0 });
    await vi.waitFor(() => expect(socket.sent.at(-1)?.type).toBe('audio.flush'));
    expect(socket.sent.slice(2).map((item) => item.type)).toEqual([
      'audio.chunk',
      'audio.chunk',
      'audio.segment_commit',
      'audio.flush',
    ]);
    expect(socket.sent.find((item) => item.type === 'audio.segment_start')?.startedAt).toBe(
      capturedAt,
    );
    expect(socket.sent.slice(2, 4).map((item) => item.seq)).toEqual([0, 1]);
    expect(socket.sent.at(-2)).toMatchObject({ clientSegmentId, lastSeq: 1 });
    expect(socket.sent.at(-1)).toMatchObject({ lastSegmentId: segmentId, lastSeq: 1, closeId });
    let done = false;
    void flushed.then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    socket.receive({ type: 'audio.flushed', streamId, closeId });
    await flushed;
    expect(socket.readyState).toBe(3);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('flushes silent streams with two null last fields', async () => {
    const { transport, socket } = await connected();
    const flushed = transport.flush(closeId);
    await vi.waitFor(() => expect(socket.sent.at(-1)?.type).toBe('audio.flush'));
    expect(socket.sent.at(-1)).toMatchObject({ lastSegmentId: null, lastSeq: null });
    socket.receive({ type: 'audio.flushed', streamId, closeId });
    await flushed;
  });

  it('queues captured segments until the previous server segment is committed, preserving all PCM and capture times', async () => {
    const { transport, socket, onFailure } = await connected();
    // Strict emulator of SpeechCoordinator: at most one active server segment;
    // its chunks require readiness and a commit must contain the final sequence.
    let serverActive: { id: unknown; ready: boolean; nextSeq: number } | null = null;
    socket.inspect = (message) => {
      if (message.type === 'audio.segment_start') {
        if (serverActive) throw new Error('SEGMENT_ALREADY_ACTIVE');
        serverActive = { id: message.clientSegmentId, ready: false, nextSeq: 0 };
      } else if (message.type === 'audio.chunk') {
        expect(serverActive?.id).toBe(message.clientSegmentId);
        expect(serverActive?.ready).toBe(true);
        expect(message.seq).toBe(serverActive!.nextSeq++);
      } else if (message.type === 'audio.segment_commit') {
        expect(serverActive?.id).toBe(message.clientSegmentId);
        expect(message.lastSeq).toBe(serverActive!.nextSeq - 1);
        serverActive = null;
      } else if (message.type === 'audio.flush') {
        expect(serverActive).toBeNull();
      }
    };
    const acknowledge = (clientSegmentId: unknown, serverId: string, startOrder: number) => {
      expect(serverActive?.id).toBe(clientSegmentId);
      serverActive!.ready = true;
      socket.receive({
        type: 'audio.segment_ready',
        clientSegmentId,
        segmentId: serverId,
        startOrder,
      });
    };
    const capturedTimes = [
      '2026-10-09T01:02:03.100Z',
      '2026-10-09T01:02:04.400Z',
      '2026-10-09T01:02:05.700Z',
    ];
    transport.beginSegment(capturedTimes[0]);
    const first = socket.sent.at(-1)!.clientSegmentId;
    transport.append(new Int16Array([1, -1]));
    transport.append(new Int16Array([2]));
    transport.commit();
    transport.beginSegment(capturedTimes[1]);
    transport.append(new Int16Array([3, -3]));
    transport.commit();
    transport.beginSegment(capturedTimes[2]);
    transport.append(new Int16Array([4, -4]));
    transport.commit();
    const flushed = transport.flush(closeId);
    expect(socket.sent.map((message) => message.type)).toEqual([
      'audio.start',
      'audio.segment_start',
    ]);
    expect(onFailure).not.toHaveBeenCalled();
    acknowledge(first, crypto.randomUUID(), 0);
    const second = socket.sent.at(-1)!.clientSegmentId;
    expect(socket.sent.at(-1)).toMatchObject({
      type: 'audio.segment_start',
      startedAt: capturedTimes[1],
    });
    acknowledge(second, crypto.randomUUID(), 1);
    const third = socket.sent.at(-1)!.clientSegmentId;
    expect(socket.sent.at(-1)).toMatchObject({
      type: 'audio.segment_start',
      startedAt: capturedTimes[2],
    });
    acknowledge(third, segmentId, 2);
    await vi.waitFor(() => expect(socket.sent.at(-1)?.type).toBe('audio.flush'));
    expect(socket.sent.map((message) => message.type)).toEqual([
      'audio.start',
      'audio.segment_start',
      'audio.chunk',
      'audio.chunk',
      'audio.segment_commit',
      'audio.segment_start',
      'audio.chunk',
      'audio.segment_commit',
      'audio.segment_start',
      'audio.chunk',
      'audio.segment_commit',
      'audio.flush',
    ]);
    const chunks = socket.sent.filter((item) => item.type === 'audio.chunk');
    expect(chunks.map((item) => [item.clientSegmentId, item.seq])).toEqual([
      [first, 0],
      [first, 1],
      [second, 0],
      [third, 0],
    ]);
    expect(chunks.map((item) => item.pcmBase64)).toEqual([
      pcm16ToBase64(new Int16Array([1, -1])),
      pcm16ToBase64(new Int16Array([2])),
      pcm16ToBase64(new Int16Array([3, -3])),
      pcm16ToBase64(new Int16Array([4, -4])),
    ]);
    expect(
      socket.sent
        .filter((item) => item.type === 'audio.segment_start')
        .map((item) => item.startedAt),
    ).toEqual(capturedTimes);
    expect(socket.sent.at(-1)).toMatchObject({ lastSegmentId: segmentId, lastSeq: 0 });
    socket.receive({ type: 'audio.flushed', streamId, closeId });
    await flushed;
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('starts each readiness timeout when that segment reaches the server', async () => {
    vi.useFakeTimers();
    const { transport, socket, onFailure } = await connected();
    transport.beginSegment();
    const first = socket.sent.at(-1)!.clientSegmentId;
    transport.append(new Int16Array([1]));
    transport.commit();
    transport.beginSegment();
    transport.append(new Int16Array([2]));
    transport.commit();
    await vi.advanceTimersByTimeAsync(14_000);
    socket.receive({
      type: 'audio.segment_ready',
      clientSegmentId: first,
      segmentId: crypto.randomUUID(),
      startOrder: 0,
    });
    const second = socket.sent.at(-1)!.clientSegmentId;
    await vi.advanceTimersByTimeAsync(14_000);
    expect(onFailure).not.toHaveBeenCalled();
    socket.receive({
      type: 'audio.segment_ready',
      clientSegmentId: second,
      segmentId,
      startOrder: 1,
    });
    await transport.drain();
    transport.stop();
  });

  it('reports provider errors once and never reconnects or resends audio', async () => {
    const { transport, socket, onFailure } = await connected();
    transport.beginSegment();
    transport.append(new Int16Array([1]));
    transport.commit();
    const flush = transport.flush(closeId);
    socket.receive({
      type: 'audio.error',
      error: { code: 'AI_FAILED', message: 'OpenAI unavailable', details: null },
      requestId: 'request',
    });
    await expect(flush).rejects.toMatchObject({ code: 'provider_failed' });
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ code: 'provider_failed' }),
    );
    expect(socket.readyState).toBe(3);
    expect(socket.sent.map((item) => item.type)).toEqual(['audio.start', 'audio.segment_start']);
  });

  it('rejects stale acknowledgements and malformed messages', async () => {
    const { socket, onFailure } = await connected();
    socket.receive({ type: 'audio.flushed', streamId, closeId });
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ code: 'protocol_error' }));
  });

  it('uses 20-second heartbeat and fails a silent lost connection', async () => {
    vi.useFakeTimers();
    const { socket, onFailure } = await connected();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(socket.sent.at(-1)).toEqual({ type: 'heartbeat.ping' });
    socket.receive({ type: 'heartbeat.pong' });
    await vi.advanceTimersByTimeAsync(74_000);
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ code: 'connection_failed' }));
  });

  it('bounds pending audio and fails readiness timeouts explicitly', async () => {
    vi.useFakeTimers();
    const { transport, onFailure } = await connected();
    transport.beginSegment();
    transport.append(new Int16Array([1]));
    transport.commit();
    const drain = transport.drain();
    const result = expect(drain).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it('encodes signed PCM16 in little endian without a WAV header', () => {
    const binary = atob(pcm16ToBase64(new Int16Array([0, 32767, -32768, -1])));
    expect(Array.from(binary, (item) => item.charCodeAt(0))).toEqual([
      0, 0, 255, 127, 0, 128, 255, 255,
    ]);
  });
});

describe('recoverable audio input', () => {
  it('keeps capture alive for processing failures', async () => {
    const { socket, transport, onFailure } = await connected();
    socket.receive({
      type: 'audio.processing_error',
      groupId: null,
      segmentId: null,
      error: { code: 'AI_FAILED', message: 'retry this group', details: null },
    });
    expect(onFailure).not.toHaveBeenCalled();
    expect(socket.readyState).toBe(1);
    transport.close();
  });
  it('resumes the same stream and replays unacknowledged PCM with the same segment identity', async () => {
    vi.useFakeTimers();
    const sockets: Socket[] = [];
    const onFailure = vi.fn();
    const transport = new AudioTransport({
      url: 'ws://localhost',
      onFailure,
      socketFactory: () => {
        const s = new Socket();
        s.autoAck = false;
        sockets.push(s);
        return s;
      },
    });
    const ready = transport.connect(topicId),
      first = sockets[0]!;
    first.open();
    first.receive({ type: 'audio.ready', streamId, topicId });
    await ready;
    transport.beginSegment();
    const clientSegmentId = first.sent.at(-1)!.clientSegmentId;
    first.receive({ type: 'audio.segment_ready', clientSegmentId, segmentId, startOrder: 0 });
    transport.append(new Int16Array([5, 6, 7]));
    transport.commit(3);
    first.close();
    await vi.advanceTimersByTimeAsync(1000);
    const second = sockets[1]!;
    second.open();
    expect(second.sent[0]).toMatchObject({
      resumeStreamId: streamId,
      clientStreamId: first.sent[0]!.clientStreamId,
    });
    second.receive({ type: 'audio.ready', streamId, topicId });
    second.receive({ type: 'audio.segment_ready', clientSegmentId, segmentId, startOrder: 0 });
    expect(second.sent.filter((m) => m.type === 'audio.chunk')).toEqual(
      first.sent.filter((m) => m.type === 'audio.chunk'),
    );
    second.receive({ type: 'audio.segment_committed', clientSegmentId, segmentId, lastSeq: 0 });
    await transport.drain();
    expect(onFailure).not.toHaveBeenCalled();
    transport.close();
    await vi.advanceTimersByTimeAsync(10000);
    expect(sockets).toHaveLength(2);
  });
});
