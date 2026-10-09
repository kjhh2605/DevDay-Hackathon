import { BrowserCaptureSource } from './browser-source.js';
import type { CaptureSource } from './browser-source.js';
import { EnergyVad } from './dsp.js';
import { AudioTransport } from './transport.js';
import type { AudioTransportOptions } from './transport.js';
import { CaptureError, microphoneError } from './types.js';
import type { CaptureController, CaptureControllerOptions, CaptureState } from './types.js';

type Transport = Pick<
  AudioTransport,
  'connect' | 'beginSegment' | 'append' | 'commit' | 'drain' | 'flush' | 'stop' | 'close'
>;

/** Dependency seam used to verify the capture lifecycle without a microphone. */
export interface CaptureDependencies {
  sourceFactory?: (onFailure: (error: CaptureError) => void) => CaptureSource;
  transportFactory?: (options: AudioTransportOptions) => Transport;
  now?: () => number;
}

function socketUrl(url?: string): string {
  const resolved = new URL(url ?? '/ws/audio', globalThis.location?.href ?? 'http://localhost');
  if (resolved.protocol === 'https:') resolved.protocol = 'wss:';
  if (resolved.protocol === 'http:') resolved.protocol = 'ws:';
  return resolved.href;
}

class Controller implements CaptureController {
  private state: CaptureState = { status: 'idle', topicId: null };
  private source: CaptureSource | null = null;
  private transport: Transport | null = null;
  private readonly vad = new EnergyVad();
  private acceptFrames = false;
  private captureStartedAtMs = 0;
  private epoch = 0;
  private starting: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;
  private sourceDrained: Promise<void> | null = null;
  private flushing: { closeId: string; promise: Promise<void> } | null = null;

  constructor(
    private readonly options: CaptureControllerOptions,
    private readonly dependencies: CaptureDependencies,
  ) {}

  getState(): CaptureState {
    return { ...this.state };
  }

  startCapture(topicId: string): Promise<void> {
    if (this.state.topicId === topicId && this.state.status === 'capturing')
      return Promise.resolve();
    if (this.starting && this.state.topicId === topicId) return this.starting;
    if (
      this.starting ||
      this.stopping ||
      this.state.status === 'capturing' ||
      this.state.status === 'flushing'
    ) {
      return Promise.reject(
        new CaptureError('protocol_error', '현재 마이크 입력을 먼저 종료해 주세요.'),
      );
    }
    const epoch = ++this.epoch;
    this.flushing = null;
    this.vad.reset();
    this.setState({ status: 'requesting_permission', topicId });
    const source =
      this.source ??
      (this.dependencies.sourceFactory ?? ((onFailure) => new BrowserCaptureSource(onFailure)))(
        (error) => this.fail(error),
      );
    this.source = source;
    const operation = async () => {
      try {
        await source.prepare();
        if (epoch !== this.epoch) {
          await source.release();
          return;
        }
        this.setState({ status: 'connecting', topicId });
        const transport = (
          this.dependencies.transportFactory ?? ((options) => new AudioTransport(options))
        )({
          url: socketUrl(this.options.url),
          connectionTimeoutMs: this.options.connectionTimeoutMs,
          flushTimeoutMs: this.options.flushTimeoutMs,
          onFailure: (error) => this.fail(error),
          onProcessingError: (error) => this.options.onProcessingError?.(error),
          onConnectionState: (status) => {
            if (epoch === this.epoch) this.setState({ status, topicId });
          },
        });
        this.transport = transport;
        await transport.connect(topicId);
        if (this.state.error) throw this.state.error;
        if (epoch !== this.epoch) {
          transport.close();
          await source.release();
          return;
        }
        this.acceptFrames = true;
        this.captureStartedAtMs = (this.dependencies.now ?? Date.now)();
        const captureStartedAt = await source.start((pcm) => this.receiveFrame(pcm));
        if (typeof captureStartedAt === 'number') this.captureStartedAtMs = captureStartedAt;
        if (this.state.error) throw this.state.error;
        if (epoch !== this.epoch) {
          this.acceptFrames = false;
          await source.release();
          return;
        }
        this.setState({ status: 'capturing', topicId });
      } catch (cause) {
        if (epoch !== this.epoch) return;
        const error = cause instanceof CaptureError ? cause : microphoneError(cause);
        this.fail(error);
        throw error;
      }
    };
    this.starting = operation().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  flush(closeId: string): Promise<void> {
    if (this.flushing) {
      return this.flushing.closeId === closeId
        ? this.flushing.promise
        : Promise.reject(
            new CaptureError('protocol_error', '다른 주제 종료 요청이 진행 중입니다.'),
          );
    }
    const operation = async () => {
      try {
        if (this.starting) await this.starting;
        if (!this.transport || !this.source || this.state.status !== 'capturing') {
          throw (
            this.state.error ?? new CaptureError('protocol_error', '종료할 마이크 입력이 없습니다.')
          );
        }
        this.setState({ status: 'flushing', topicId: this.state.topicId });
        const source = this.source;
        const transport = this.transport;
        // Worklet acknowledgement follows its final partial frame on the same MessagePort.
        this.sourceDrained = source.flush();
        await this.sourceDrained;
        this.acceptFrames = false;
        this.emit(this.vad.flush());
        await transport.flush(closeId);
        this.transport = null;
        this.vad.reset();
        this.setState({ status: 'stopped', topicId: this.state.topicId });
      } catch (cause) {
        const error =
          cause instanceof CaptureError
            ? cause
            : new CaptureError('connection_failed', '마지막 음성 처리를 완료하지 못했습니다.', {
                cause,
              });
        this.fail(error);
        throw error;
      }
    };
    const promise = operation();
    this.flushing = { closeId, promise };
    return promise;
  }

  stopCapture(): Promise<void> {
    if (this.stopping) return this.stopping;
    const operation = async () => {
      if (this.state.status === 'reconnecting') {
        ++this.epoch;
        this.acceptFrames = false;
        this.transport?.close();
        await this.source?.release();
        this.source = null;
      } else if (this.state.status === 'flushing' && this.flushing) {
        // Stop using the physical microphone immediately while the server finishes its work.
        await this.sourceDrained?.catch(() => undefined);
        await this.source?.release();
        this.source = null;
        await this.flushing.promise.catch(() => undefined);
      } else {
        ++this.epoch;
        if (this.starting) {
          this.transport?.close();
          await this.source?.release();
          await this.starting.catch(() => undefined);
        } else if (
          this.source &&
          this.transport &&
          ['capturing', 'reconnecting'].includes(this.state.status)
        ) {
          try {
            await this.source.flush();
            this.acceptFrames = false;
            this.emit(this.vad.flush());
            await this.transport.drain();
            this.transport.stop();
          } catch (cause) {
            this.fail(
              cause instanceof CaptureError
                ? cause
                : new CaptureError('connection_failed', '마지막 음성을 전송하지 못했습니다.', {
                    cause,
                  }),
            );
          }
        }
        this.transport?.close();
        await this.source?.release();
        this.source = null;
      }
      this.acceptFrames = false;
      this.transport = null;
      this.vad.reset();
      if (this.state.status !== 'error')
        this.setState({ status: 'stopped', topicId: this.state.topicId });
    };
    this.stopping = operation().finally(() => {
      this.stopping = null;
    });
    return this.stopping;
  }

  private receiveFrame(pcm: Int16Array): void {
    if (!this.acceptFrames) return;
    try {
      this.emit(this.vad.push(pcm));
    } catch (cause) {
      this.fail(
        cause instanceof CaptureError
          ? cause
          : new CaptureError('protocol_error', '음성 프레임 처리에 실패했습니다.', { cause }),
      );
    }
  }

  private emit(events: ReturnType<EnergyVad['push']>): void {
    for (const event of events) {
      if (this.state.status === 'error') return;
      if (event.type === 'start') {
        // The VAD offset includes pre-roll and advances on captured samples,
        // independent of WebSocket acknowledgements and main-thread delays.
        this.transport?.beginSegment(
          new Date(this.captureStartedAtMs + (event.sampleOffset / 24_000) * 1_000).toISOString(),
        );
      } else if (event.type === 'frame') this.transport?.append(event.pcm);
      else this.transport?.commit(event.lastVoicedSample);
    }
  }

  private setState(state: CaptureState): void {
    this.state = state;
    this.options.onState?.(this.getState());
  }

  private fail(error: CaptureError): void {
    if (this.state.status === 'error') return;
    this.acceptFrames = false;
    this.transport?.close();
    this.transport = null;
    const source = this.source;
    this.source = null;
    void source?.release().catch(() => undefined);
    this.setState({ status: 'error', topicId: this.state.topicId, error });
    this.options.onError?.(error);
  }
}

export function createCaptureController(
  options: CaptureControllerOptions = {},
  dependencies: CaptureDependencies = {},
): CaptureController {
  return new Controller(options, dependencies);
}
