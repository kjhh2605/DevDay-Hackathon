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
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(timeoutMs?: number, onTimeout?: (error: CaptureError) => void) {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
    // Segment readiness can fail before flush/stop starts awaiting it.
    void this.promise.catch(() => undefined);
    if (timeoutMs !== undefined && onTimeout) this.startTimeout(timeoutMs, onTimeout);
  }
  startTimeout(timeoutMs: number, onTimeout: (error: CaptureError) => void): void {
    if (this.settled || this.timer) return;
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
  startedAt?: string;
  startSent: boolean;
  serverId: string | null;
  ready: Pending<void>;
  acknowledged: Pending<void>;
  sentSeq: number;
  frames: { seq: number; pcmBase64: string }[];
  nextSeq: number;
  committed: boolean;
  commitSent: boolean;
  lastVoicedSample?: number;
}

export interface AudioTransportOptions {
  url: string;
  onFailure: (error: CaptureError) => void;
  onProcessingError?: (message: string) => void;
  onConnectionState?: (state: 'reconnecting' | 'capturing') => void;
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

/** Ordered PCM replay is retained until the server confirms durable segment storage. */
export class AudioTransport {
  private socket: AudioSocket | null = null;
  private streamId: string | null = null;
  private topicId: string | null = null;
  private ready: Pending<void> | null = null;
  private segments: Segment[] = [];
  private transmitIndex = 0;
  private active: Segment | null = null;
  private flushing: { closeId: string; pending: Pending<void> } | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeatAt = 0;
  private error: CaptureError | null = null;
  private closed = false;
  private queuedChars = 0;
  private clientStreamId = '';
  private retryCount = 0;
  private reconnecting = false;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private lastCommitted: { serverId: string; lastSeq: number } | null = null;

  constructor(private readonly options: AudioTransportOptions) {}

  async connect(topicId: string): Promise<void> {
    this.topicId = topicId;
    this.clientStreamId = this.uuid();
    this.ready = new Pending<void>(this.options.connectionTimeoutMs ?? 15_000, (error) =>
      this.fail(error),
    );
    this.openSocket();
    return this.ready.promise;
  }

  private openSocket(): void {
    try {
      this.socket = (
        this.options.socketFactory ?? ((url) => new WebSocket(url) as unknown as AudioSocket)
      )(this.options.url);
    } catch (cause) {
      this.fail(
        new CaptureError('connection_failed', '음성 서버에 연결하지 못했습니다.', { cause }),
      );
      return;
    }
    this.socket.onopen = () => {
      this.send({
        type: 'audio.start',
        topicId: this.topicId!,
        clientStreamId: this.clientStreamId,
        ...(this.streamId ? { resumeStreamId: this.streamId } : {}),
        format: 'pcm16',
        sampleRate: 24000,
        channels: 1,
      });
      this.lastHeartbeatAt = Date.now();
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastHeartbeatAt > 45_000) return this.reconnect();
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
    this.socket.onerror = () => this.reconnect();
    this.socket.onclose = () => {
      if (!this.closed) this.reconnect();
    };
  }

  beginSegment(startedAt?: string): void {
    this.assertReady();
    if (this.active || this.flushing)
      throw new CaptureError('protocol_error', '새 음성 구간을 시작할 수 없습니다.');
    const segment: Segment = {
      clientId: this.uuid(),
      startedAt,
      startSent: false,
      serverId: null,
      ready: new Pending<void>(),
      acknowledged: new Pending<void>(),
      sentSeq: 0,
      frames: [],
      nextSeq: 0,
      committed: false,
      commitSent: false,
    };
    this.segments.push(segment);
    this.active = segment;
    this.pumpSegments();
  }

  append(pcm: Int16Array): void {
    this.assertReady();
    if (!this.active || this.active.committed)
      throw new CaptureError('protocol_error', '음성 구간이 시작되지 않았습니다.');
    if (!pcm.length) return;
    const frame = { seq: this.active.nextSeq++, pcmBase64: pcm16ToBase64(pcm) };
    this.active.frames.push(frame);
    this.queuedChars += frame.pcmBase64.length;
    if (this.queuedChars > 4_000_000)
      this.fail(
        new CaptureError('connection_failed', '음성 서버 전송이 지연되어 캡처를 중단했습니다.'),
      );
    this.pumpSegments();
  }

  commit(lastVoicedSample?: number): void {
    this.assertReady();
    if (!this.active) return;
    if (!this.active.nextSeq)
      throw new CaptureError('protocol_error', '빈 음성 구간은 확정할 수 없습니다.');
    this.active.lastVoicedSample = lastVoicedSample;
    this.active.committed = true;
    this.active = null;
    this.pumpSegments();
  }

  async drain(): Promise<void> {
    await Promise.all(this.segments.map((segment) => segment.acknowledged.promise));
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
      const last = this.lastCommitted;
      this.send({
        type: 'audio.flush',
        streamId: this.streamId!,
        closeId,
        lastSegmentId: last?.serverId ?? null,
        lastSeq: last?.lastSeq ?? null,
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
    clearTimeout(this.retryTimer);
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
    for (const segment of this.segments) {
      segment.ready.reject(cancellation);
      segment.acknowledged.reject(cancellation);
    }
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

  private pumpSegments(): void {
    // Capture may advance while the server prepares a segment. Keep its PCM and
    // capture timestamp queued, but only open the next server segment after the
    // preceding segment's chunks and commit have been sent in order.
    while (
      this.transmitIndex < this.segments.length &&
      !this.error &&
      !this.closed &&
      !this.reconnecting
    ) {
      const segment = this.segments[this.transmitIndex]!;
      if (!segment.startSent) {
        segment.startSent = true;
        segment.ready.startTimeout(this.options.connectionTimeoutMs ?? 15_000, (error) =>
          this.fail(error),
        );
        this.send({
          type: 'audio.segment_start',
          streamId: this.streamId!,
          clientSegmentId: segment.clientId,
          ...(segment.startedAt ? { startedAt: segment.startedAt } : {}),
        });
      }
      if (!segment.serverId || this.error || this.closed) return;
      const frames = segment.frames.slice(segment.sentSeq);
      for (const frame of frames) {
        this.send({
          type: 'audio.chunk',
          streamId: this.streamId!,
          clientSegmentId: segment.clientId,
          ...frame,
        });
        segment.sentSeq++;
        if (this.error || this.closed) return;
      }
      if (!segment.committed) return;
      if (!segment.commitSent) {
        segment.commitSent = true;
        segment.acknowledged.startTimeout(this.options.connectionTimeoutMs ?? 15_000, (error) =>
          this.fail(error),
        );
        this.send({
          type: 'audio.segment_commit',
          streamId: this.streamId!,
          clientSegmentId: segment.clientId,
          lastSeq: segment.nextSeq - 1,
          ...(segment.lastVoicedSample !== undefined
            ? { lastVoicedSample: segment.lastVoicedSample }
            : {}),
        });
      }
      this.transmitIndex++;
    }
  }

  private receive(message: AudioServerMessage): void {
    this.lastHeartbeatAt = Date.now();
    switch (message.type) {
      case 'heartbeat.ping':
        this.send({ type: 'heartbeat.pong' });
        return;
      case 'heartbeat.pong':
        return;
      case 'audio.processing_error':
        this.options.onProcessingError?.(message.error.message);
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
        if (this.reconnecting) {
          clearTimeout(this.retryTimer);
          this.reconnecting = false;
          this.retryCount = 0;
          this.options.onConnectionState?.('capturing');
          this.pumpSegments();
        }
        return;
      case 'audio.segment_ready': {
        const segment = this.segments.find((item) => item.clientId === message.clientSegmentId);
        if (
          !segment ||
          !segment.startSent ||
          (segment.serverId && segment.serverId !== message.segmentId)
        )
          throw new CaptureError('protocol_error', '음성 구간 응답이 일치하지 않습니다.');
        segment.serverId = message.segmentId;
        this.pumpSegments();
        segment.ready.resolve();
        return;
      }
      case 'audio.segment_committed': {
        const segment = this.segments.find((s) => s.clientId === message.clientSegmentId);
        if (!segment) return;
        if (
          segment.serverId !== message.segmentId ||
          message.lastSeq !== segment.nextSeq - 1 ||
          !segment.committed
        )
          throw new CaptureError('protocol_error', '음성 저장 응답이 일치하지 않습니다.');
        segment.acknowledged.resolve();
        this.lastCommitted = { serverId: message.segmentId, lastSeq: message.lastSeq };
        this.queuedChars -= segment.frames.reduce((n, frame) => n + frame.pcmBase64.length, 0);
        const index = this.segments.indexOf(segment);
        this.segments.splice(index, 1);
        if (index < this.transmitIndex) this.transmitIndex--;
        return;
      }
      case 'audio.flushed':
        if (message.streamId !== this.streamId || message.closeId !== this.flushing?.closeId)
          throw new CaptureError('protocol_error', '음성 종료 응답이 일치하지 않습니다.');
        this.flushing.pending.resolve();
        this.close();
    }
  }

  private reconnect(): void {
    if (this.closed || this.error) return;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.socket) {
      this.socket.onopen = this.socket.onmessage = this.socket.onerror = this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
    clearTimeout(this.retryTimer);
    if (this.flushing) {
      this.fail(
        new CaptureError(
          'connection_failed',
          '마지막 음성 연결이 끊겼습니다. 주제 종료를 다시 시도해 주세요.',
        ),
      );
      return;
    }
    if (this.retryCount >= 3) {
      this.fail(
        new CaptureError(
          'connection_failed',
          '음성 연결을 복구하지 못했습니다. 다시 시도해 주세요.',
        ),
      );
      return;
    }
    this.reconnecting = true;
    this.options.onConnectionState?.('reconnecting');
    this.transmitIndex = 0;
    for (const segment of this.segments) {
      segment.startSent = false;
      segment.serverId = null;
      segment.sentSeq = 0;
      segment.commitSent = false;
    }
    const delay = [1_000, 2_000, 4_000][this.retryCount++]!;
    this.retryTimer = setTimeout(() => {
      if (this.closed) return;
      this.openSocket();
      this.retryTimer = setTimeout(() => this.reconnect(), 2_000);
    }, delay);
  }

  private fail(error: CaptureError): void {
    if (this.error || this.closed) return;
    this.error = error;
    this.close();
    this.options.onFailure(error);
  }
}
