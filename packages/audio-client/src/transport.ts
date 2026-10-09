import { AudioClientMessageSchema, AudioServerMessageSchema } from '@devday/contracts';
import type { AudioClientMessage, AudioServerMessage } from '@devday/contracts';
import { CaptureError } from './types.js';

export interface AudioSocket {
  readyState: number;
  bufferedAmount: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

class Pending<T> {
  readonly promise: Promise<T>;
  private settled = false;
  private resolvePromise!: (value: T) => void;
  private rejectPromise!: (error: CaptureError) => void;
  private readonly timer: ReturnType<typeof setTimeout>;
  constructor(timeoutMs: number, onTimeout: (error: CaptureError) => void) {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
    // Segment readiness can fail before flush/stop starts awaiting it.
    void this.promise.catch(() => undefined);
    this.timer = setTimeout(
      () => onTimeout(new CaptureError('timeout', '음성 서버 응답 시간이 초과되었습니다.')),
      timeoutMs,
    );
  }
  resolve(value: T): void {
    if (!this.settled) {
      this.settled = true;
      clearTimeout(this.timer);
      this.resolvePromise(value);
    }
  }
  reject(error: CaptureError): void {
    if (!this.settled) {
      this.settled = true;
      clearTimeout(this.timer);
      this.rejectPromise(error);
    }
  }
}

interface Segment {
  clientId: string;
  serverId: string | null;
  ready: Pending<void>;
  frames: { seq: number; pcmBase64: string }[];
  nextSeq: number;
  committed: boolean;
  commitSent: boolean;
}

export interface AudioTransportOptions {
  url: string;
  onFailure: (error: CaptureError) => void;
  connectionTimeoutMs?: number;
  flushTimeoutMs?: number;
  socketFactory?: (url: string) => AudioSocket;
  uuid?: () => string;
}

export function pcm16ToBase64(pcm: Int16Array): string {
  const buffer = new ArrayBuffer(pcm.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < pcm.length; i++) view.setInt16(i * 2, pcm[i]!, true);
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Ordered, bounded audio transmission. There is intentionally no reconnect or retry. */
export class AudioTransport {
  private socket: AudioSocket | null = null;
  private streamId: string | null = null;
  private topicId: string | null = null;
  private ready: Pending<void> | null = null;
  private segments: Segment[] = [];
  private active: Segment | null = null;
  private flushing: { closeId: string; pending: Pending<void> } | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeatAt = 0;
  private error: CaptureError | null = null;
  private closed = false;
  private queuedChars = 0;

  constructor(private readonly options: AudioTransportOptions) {}

  async connect(topicId: string): Promise<void> {
    this.topicId = topicId;
    this.ready = new Pending<void>(this.options.connectionTimeoutMs ?? 15_000, (error) =>
      this.fail(error),
    );
    try {
      this.socket = (
        this.options.socketFactory ?? ((url) => new WebSocket(url) as unknown as AudioSocket)
      )(this.options.url);
    } catch (cause) {
      this.fail(
        new CaptureError('connection_failed', '음성 서버에 연결하지 못했습니다.', { cause }),
      );
      return this.ready.promise;
    }
    this.socket.onopen = () => {
      this.send({
        type: 'audio.start',
        topicId,
        clientStreamId: this.uuid(),
        format: 'pcm16',
        sampleRate: 24000,
        channels: 1,
      });
      this.lastHeartbeatAt = Date.now();
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastHeartbeatAt > 45_000)
          return this.fail(
            new CaptureError('connection_failed', '음성 서버 연결이 응답하지 않습니다.'),
          );
        this.send({ type: 'heartbeat.ping' });
      }, 20_000);
    };
    this.socket.onmessage = (event) => {
      try {
        const parsed = AudioServerMessageSchema.safeParse(
          typeof event.data === 'string' ? JSON.parse(event.data) : null,
        );
        if (!parsed.success)
          throw new CaptureError('protocol_error', '음성 서버 응답 형식이 올바르지 않습니다.');
        this.receive(parsed.data);
      } catch (cause) {
        this.fail(
          cause instanceof CaptureError
            ? cause
            : new CaptureError('protocol_error', '음성 서버 응답을 읽지 못했습니다.', { cause }),
        );
      }
    };
    this.socket.onerror = () =>
      this.fail(new CaptureError('connection_failed', '음성 서버 연결에 실패했습니다.'));
    this.socket.onclose = () => {
      if (!this.closed)
        this.fail(new CaptureError('connection_failed', '음성 서버 연결이 끊겼습니다.'));
    };
    return this.ready.promise;
  }

  beginSegment(startedAt?: string): void {
    this.assertReady();
    if (this.active || this.flushing)
      throw new CaptureError('protocol_error', '새 음성 구간을 시작할 수 없습니다.');
    const segment: Segment = {
      clientId: this.uuid(),
      serverId: null,
      ready: new Pending<void>(this.options.connectionTimeoutMs ?? 15_000, (error) =>
        this.fail(error),
      ),
      frames: [],
      nextSeq: 0,
      committed: false,
      commitSent: false,
    };
    this.segments.push(segment);
    this.active = segment;
    this.send({
      type: 'audio.segment_start',
      streamId: this.streamId!,
      clientSegmentId: segment.clientId,
      ...(startedAt ? { startedAt } : {}),
    });
  }

  append(pcm: Int16Array): void {
    this.assertReady();
    if (!this.active || this.active.committed)
      throw new CaptureError('protocol_error', '음성 구간이 시작되지 않았습니다.');
    if (!pcm.length) return;
    const frame = { seq: this.active.nextSeq++, pcmBase64: pcm16ToBase64(pcm) };
    if (this.active.serverId)
      this.send({
        type: 'audio.chunk',
        streamId: this.streamId!,
        clientSegmentId: this.active.clientId,
        ...frame,
      });
    else {
      this.active.frames.push(frame);
      this.queuedChars += frame.pcmBase64.length;
      if (this.queuedChars > 4_000_000)
        this.fail(
          new CaptureError('connection_failed', '음성 서버 전송이 지연되어 캡처를 중단했습니다.'),
        );
    }
  }

  commit(): void {
    this.assertReady();
    if (!this.active) return;
    if (!this.active.nextSeq)
      throw new CaptureError('protocol_error', '빈 음성 구간은 확정할 수 없습니다.');
    this.active.committed = true;
    this.sendCommit(this.active);
    this.active = null;
  }

  async drain(): Promise<void> {
    await Promise.all(this.segments.map((segment) => segment.ready.promise));
    this.assertReady();
    if (this.active)
      throw new CaptureError('protocol_error', '마지막 음성 구간이 확정되지 않았습니다.');
  }

  async flush(closeId: string): Promise<void> {
    if (this.flushing) {
      if (this.flushing.closeId !== closeId)
        throw new CaptureError('protocol_error', '다른 주제 종료 요청이 진행 중입니다.');
      return this.flushing.pending.promise;
    }
    this.assertReady();
    const pending = new Pending<void>(this.options.flushTimeoutMs ?? 180_000, (error) =>
      this.fail(error),
    );
    this.flushing = { closeId, pending };
    try {
      await this.drain();
      const last = this.segments.at(-1);
      this.send({
        type: 'audio.flush',
        streamId: this.streamId!,
        closeId,
        lastSegmentId: last?.serverId ?? null,
        lastSeq: last ? last.nextSeq - 1 : null,
      });
    } catch (cause) {
      this.fail(
        cause instanceof CaptureError
          ? cause
          : new CaptureError('connection_failed', '마지막 음성을 전송하지 못했습니다.', { cause }),
      );
    }
    return pending.promise;
  }

  stop(): void {
    if (this.streamId && !this.closed && !this.error)
      this.send({ type: 'audio.stop', streamId: this.streamId });
    this.close();
  }

  close(): void {
    this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;
      this.socket.onclose = null;
      this.socket.close(1000, 'capture complete');
      this.socket = null;
    }
    const cancellation =
      this.error ?? new CaptureError('connection_failed', '음성 입력 연결이 종료되었습니다.');
    this.ready?.reject(cancellation);
    for (const segment of this.segments) segment.ready.reject(cancellation);
    this.flushing?.pending.reject(cancellation);
  }

  private uuid(): string {
    return (this.options.uuid ?? (() => crypto.randomUUID()))();
  }

  private assertReady(): void {
    if (this.error) throw this.error;
    if (!this.streamId || this.closed)
      throw new CaptureError('connection_failed', '음성 입력 연결이 준비되지 않았습니다.');
  }

  private send(message: AudioClientMessage): void {
    if (this.error || this.closed) return;
    if (!this.socket || this.socket.readyState !== 1)
      return this.fail(
        new CaptureError('connection_failed', '음성 서버 연결이 열려 있지 않습니다.'),
      );
    if (this.socket.bufferedAmount > 4_000_000)
      return this.fail(
        new CaptureError('connection_failed', '음성 전송이 지연되어 캡처를 중단했습니다.'),
      );
    try {
      this.socket.send(JSON.stringify(AudioClientMessageSchema.parse(message)));
    } catch (cause) {
      this.fail(new CaptureError('connection_failed', '음성을 전송하지 못했습니다.', { cause }));
    }
  }

  private sendCommit(segment: Segment): void {
    if (!segment.serverId || !segment.committed || segment.commitSent) return;
    this.send({
      type: 'audio.segment_commit',
      streamId: this.streamId!,
      clientSegmentId: segment.clientId,
      lastSeq: segment.nextSeq - 1,
    });
    segment.commitSent = true;
  }

  private receive(message: AudioServerMessage): void {
    this.lastHeartbeatAt = Date.now();
    switch (message.type) {
      case 'heartbeat.ping':
        this.send({ type: 'heartbeat.pong' });
        return;
      case 'heartbeat.pong':
        return;
      case 'audio.error': {
        const code = /OPENAI|PROVIDER|TRANSCRI|MODEL|AI_|AUDIO_FAILED/.test(message.error.code)
          ? 'provider_failed'
          : 'protocol_error';
        this.fail(new CaptureError(code, message.error.message));
        return;
      }
      case 'audio.ready':
        if (
          message.topicId !== this.topicId ||
          (this.streamId && this.streamId !== message.streamId)
        )
          throw new CaptureError('protocol_error', '음성 연결의 주제가 일치하지 않습니다.');
        this.streamId = message.streamId;
        this.ready!.resolve();
        return;
      case 'audio.segment_ready': {
        const segment = this.segments.find((item) => item.clientId === message.clientSegmentId);
        if (!segment || (segment.serverId && segment.serverId !== message.segmentId))
          throw new CaptureError('protocol_error', '음성 구간 응답이 일치하지 않습니다.');
        segment.serverId = message.segmentId;
        for (const frame of segment.frames) {
          this.send({
            type: 'audio.chunk',
            streamId: this.streamId!,
            clientSegmentId: segment.clientId,
            ...frame,
          });
          this.queuedChars -= frame.pcmBase64.length;
        }
        segment.frames = [];
        this.sendCommit(segment);
        segment.ready.resolve();
        return;
      }
      case 'audio.flushed':
        if (message.streamId !== this.streamId || message.closeId !== this.flushing?.closeId)
          throw new CaptureError('protocol_error', '음성 종료 응답이 일치하지 않습니다.');
        this.flushing.pending.resolve();
        this.close();
    }
  }

  private fail(error: CaptureError): void {
    if (this.error || this.closed) return;
    this.error = error;
    this.close();
    this.options.onFailure(error);
  }
}
