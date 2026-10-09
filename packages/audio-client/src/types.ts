export type CaptureErrorCode =
  | 'microphone_permission_denied'
  | 'microphone_not_found'
  | 'microphone_unavailable'
  | 'insecure_context'
  | 'unsupported_browser'
  | 'connection_failed'
  | 'provider_failed'
  | 'protocol_error'
  | 'timeout';

export class CaptureError extends Error {
  constructor(
    public readonly code: CaptureErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CaptureError';
  }
}

export type CaptureStatus =
  | 'idle'
  | 'requesting_permission'
  | 'connecting'
  | 'reconnecting'
  | 'capturing'
  | 'flushing'
  | 'stopped'
  | 'error';

export interface CaptureState {
  status: CaptureStatus;
  topicId: string | null;
  error?: CaptureError;
}

export interface CaptureController {
  startCapture(topicId: string): Promise<void>;
  flush(closeId: string): Promise<void>;
  stopCapture(): Promise<void>;
  getState(): CaptureState;
}

export interface CaptureControllerOptions {
  onState?: (state: CaptureState) => void;
  onError?: (error: CaptureError) => void;
  onProcessingError?: (message: string) => void;
  /** Defaults to /ws/audio on the current origin. Session cookies authenticate it. */
  url?: string;
  /** A readiness/segment acknowledgement timeout, not a conversation duration limit. */
  connectionTimeoutMs?: number;
  /** The server waits for final transcription before acknowledging flush. */
  flushTimeoutMs?: number;
}

export function microphoneError(error: unknown): CaptureError {
  if (error instanceof CaptureError) return error;
  const name =
    typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return new CaptureError('microphone_permission_denied', '마이크 사용 권한을 허용해 주세요.', {
      cause: error,
    });
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return new CaptureError('microphone_not_found', '사용할 수 있는 마이크를 찾지 못했습니다.', {
      cause: error,
    });
  }
  return new CaptureError('microphone_unavailable', '마이크 장치를 사용할 수 없습니다.', {
    cause: error,
  });
}
