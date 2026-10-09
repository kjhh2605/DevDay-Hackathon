import { CaptureError, microphoneError } from './types.js';
import { captureWorkletSource } from './worklet.js';

export interface CaptureSource {
  prepare(): Promise<void>;
  start(onFrame: (pcm: Int16Array) => void): Promise<number | void>;
  flush(): Promise<void>;
  release(): Promise<void>;
}

export class BrowserCaptureSource implements CaptureSource {
  private media: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private silence: GainNode | null = null;
  private onFrame: ((pcm: Int16Array) => void) | null = null;
  private flushRequest: {
    id: string;
    resolve: () => void;
    reject: (e: CaptureError) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  constructor(private readonly onFailure: (error: CaptureError) => void) {}

  async prepare(): Promise<void> {
    if (this.media && this.context && this.worklet) return;
    if (!globalThis.isSecureContext)
      throw new CaptureError(
        'insecure_context',
        '마이크 사용에는 HTTPS 또는 localhost가 필요합니다.',
      );
    if (
      !globalThis.navigator?.mediaDevices?.getUserMedia ||
      !globalThis.AudioContext ||
      !globalThis.AudioWorkletNode
    ) {
      throw new CaptureError(
        'unsupported_browser',
        '이 브라우저는 실시간 마이크 캡처를 지원하지 않습니다.',
      );
    }
    try {
      this.media = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      for (const track of this.media.getAudioTracks())
        track.onended = () =>
          this.onFailure(new CaptureError('microphone_unavailable', '마이크 연결이 끊겼습니다.'));
      // The device's actual rate is passed into the worklet; no sample-rate relabeling.
      this.context = new AudioContext();
      await this.context.resume();
      const moduleUrl = URL.createObjectURL(
        new Blob([captureWorkletSource()], { type: 'text/javascript' }),
      );
      try {
        await this.context.audioWorklet.addModule(moduleUrl);
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }
      this.source = this.context.createMediaStreamSource(this.media);
      this.worklet = new AudioWorkletNode(this.context, 'devday-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      this.worklet.onprocessorerror = () =>
        this.onFailure(
          new CaptureError('microphone_unavailable', '마이크 신호 처리에 실패했습니다.'),
        );
      this.worklet.port.onmessage = ({ data }: MessageEvent) => {
        if (data.type === 'frame' && data.pcm instanceof ArrayBuffer)
          this.onFrame?.(new Int16Array(data.pcm));
        if (
          data.type === 'flushed' &&
          this.flushRequest &&
          this.flushRequest.id === data.requestId
        ) {
          const request = this.flushRequest;
          this.flushRequest = null;
          clearTimeout(request.timer);
          this.onFrame = null;
          request.resolve();
        }
      };
      this.silence = this.context.createGain();
      this.silence.gain.value = 0;
      this.source.connect(this.worklet);
      this.worklet.connect(this.silence);
      this.silence.connect(this.context.destination);
    } catch (error) {
      await this.release();
      throw microphoneError(error);
    }
  }

  async start(onFrame: (pcm: Int16Array) => void): Promise<number> {
    if (!this.context || !this.worklet)
      throw new CaptureError('microphone_unavailable', '마이크가 준비되지 않았습니다.');
    this.onFrame = onFrame;
    await this.context.resume();
    const captureStartedAt = Date.now();
    this.worklet.port.postMessage({ type: 'start' });
    return captureStartedAt;
  }

  async flush(): Promise<void> {
    if (!this.worklet || !this.onFrame) return;
    if (this.flushRequest)
      throw new CaptureError('protocol_error', '마이크 종료 처리가 이미 진행 중입니다.');
    await new Promise<void>((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.flushRequest = null;
        this.onFrame = null;
        reject(new CaptureError('timeout', '마이크의 마지막 음성 처리 시간이 초과되었습니다.'));
      }, 5_000);
      this.flushRequest = { id, resolve, reject, timer };
      this.worklet!.port.postMessage({ type: 'flush', requestId: id });
    });
  }

  async release(): Promise<void> {
    this.onFrame = null;
    if (this.flushRequest) {
      clearTimeout(this.flushRequest.timer);
      this.flushRequest.reject(
        new CaptureError('microphone_unavailable', '마이크 캡처가 해제되었습니다.'),
      );
      this.flushRequest = null;
    }
    this.source?.disconnect();
    this.worklet?.disconnect();
    this.worklet?.port.close();
    this.silence?.disconnect();
    for (const track of this.media?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
    const context = this.context;
    this.media = null;
    this.context = null;
    this.source = null;
    this.worklet = null;
    this.silence = null;
    if (context && context.state !== 'closed') await context.close();
  }
}
