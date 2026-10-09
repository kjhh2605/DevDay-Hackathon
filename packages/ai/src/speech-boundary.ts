import type { SpeechGroup } from '@devday/contracts';
import type { SpeechDecision } from './provider.js';

export const MAX_SPEECH_SILENCE_MS = 10_000;
export const MAX_GROUP_PCM_BYTES = 60 * 48_000;
type Reason = NonNullable<SpeechGroup['closeReason']>;
/** Synchronous boundary transitions; network/persistence never hold the silence timer. */
export class SpeechBoundary {
  private active = false;
  private closed = false;
  private generation = 0;
  private revision = -1;
  private decidedRevision = -1;
  private raw = '';
  private endedAt = 0;
  private deadline?: ReturnType<typeof setTimeout>;
  private initial?: ReturnType<typeof setTimeout>;
  private request?: AbortController;
  constructor(
    private readonly options: {
      decide(text: string, silenceMs: number, signal: AbortSignal): Promise<SpeechDecision>;
      freeze(reason: Reason): void;
      onDeciding?(): void;
      now?: () => number;
      confidence?: number;
      timeoutMs?: number;
    },
  ) {}
  private now() {
    return (this.options.now ?? (() => performance.now()))();
  }
  start() {
    if (this.closed) return;
    this.active = true;
    this.raw = '';
    this.generation++;
    this.cancel();
  }
  end(trailingSilenceMs: number) {
    if (this.closed) return;
    this.active = false;
    this.endedAt = this.now() - trailingSilenceMs;
    this.cancel();
    const generation = ++this.generation;
    this.deadline = setTimeout(
      () => {
        if (generation === this.generation && !this.active) this.close('silence_timeout');
      },
      Math.max(0, MAX_SPEECH_SILENCE_MS - trailingSilenceMs),
    );
    this.schedule();
  }
  text(raw: string, revision: number) {
    if (this.closed) return;
    this.raw = raw;
    this.revision = revision;
    this.schedule();
  }
  private schedule() {
    if (this.closed || this.active || !this.raw.trim() || this.revision === this.decidedRevision)
      return;
    if (this.initial) clearTimeout(this.initial);
    this.initial = setTimeout(
      () => void this.decide(),
      Math.max(0, 1_000 - (this.now() - this.endedAt)),
    );
  }
  private async decide() {
    if (this.closed || this.active || this.revision === this.decidedRevision) return;
    const revision = this.revision,
      generation = this.generation;
    const remaining = MAX_SPEECH_SILENCE_MS - (this.now() - this.endedAt);
    if (remaining <= 0) {
      this.close('silence_timeout');
      return;
    }
    this.decidedRevision = revision;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    const timeout = setTimeout(
      () => request.abort(),
      Math.min(this.options.timeoutMs ?? 2_000, remaining),
    );
    this.options.onDeciding?.();
    try {
      const result = await this.options.decide(this.raw, this.now() - this.endedAt, request.signal);
      if (
        request.signal.aborted ||
        this.closed ||
        this.active ||
        generation !== this.generation ||
        revision !== this.revision
      )
        return;
      if (result.choice === 'complete' && result.confidence >= (this.options.confidence ?? 0.85))
        this.close('decision_complete');
    } catch {
      /* Provider failure leaves the fixed silence deadline in force. */
    } finally {
      clearTimeout(timeout);
    }
  }
  close(reason: Reason) {
    if (this.closed) return;
    this.closed = true;
    this.cancel();
    this.options.freeze(reason);
  }
  dispose() {
    this.closed = true;
    this.cancel();
  }
  private cancel() {
    clearTimeout(this.deadline);
    clearTimeout(this.initial);
    this.request?.abort();
  }
}
