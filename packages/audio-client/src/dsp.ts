/** Streaming, band-limited conversion using the AudioContext's actual sample rate. */
export class StreamingResampler {
  private readonly step: number;
  private readonly radius = 32;
  private readonly phaseCount = 1024;
  private readonly kernels: Float64Array[] = [];
  private buffer = new Float32Array(0);
  private bufferStart = 0;
  private totalInput = 0;
  private outputIndex = 0;
  private ended = false;

  constructor(
    private readonly inputRate: number,
    private readonly outputRate = 24_000,
  ) {
    if (
      !Number.isFinite(inputRate) ||
      !Number.isFinite(outputRate) ||
      inputRate <= 0 ||
      outputRate <= 0
    ) {
      throw new RangeError('Sample rates must be finite and positive');
    }
    this.step = inputRate / outputRate;
    if (inputRate === outputRate) return;
    // Leave a transition band below the destination Nyquist frequency. The
    // Blackman-windowed sinc rejects frequencies that would otherwise alias.
    const cutoff = 0.94 * Math.min(1, outputRate / inputRate);
    for (let phase = 0; phase <= this.phaseCount; phase++) {
      const kernel = new Float64Array(this.radius * 2);
      let sum = 0;
      for (let tap = 0; tap < kernel.length; tap++) {
        const distance = tap - this.radius + 1 - phase / this.phaseCount;
        const normalized = distance / this.radius;
        const window =
          Math.abs(normalized) > 1
            ? 0
            : 0.42 +
              0.5 * Math.cos(Math.PI * normalized) +
              0.08 * Math.cos(2 * Math.PI * normalized);
        const sinc =
          distance === 0 ? cutoff : Math.sin(Math.PI * cutoff * distance) / (Math.PI * distance);
        kernel[tap] = sinc * window;
        sum += kernel[tap];
      }
      for (let tap = 0; tap < kernel.length; tap++) kernel[tap] /= sum;
      this.kernels.push(kernel);
    }
  }

  push(input: Float32Array): Float32Array {
    if (this.ended) throw new Error('Cannot push audio after resampler flush');
    if (this.inputRate === this.outputRate) return input.slice();
    const next = new Float32Array(this.buffer.length + input.length);
    next.set(this.buffer);
    next.set(input, this.buffer.length);
    this.buffer = next;
    this.totalInput += input.length;
    return this.drain(false);
  }

  /** Zero-pads the filter's lookahead, preserving input duration without an extra tail. */
  flush(): Float32Array {
    if (this.ended) return new Float32Array(0);
    this.ended = true;
    if (this.inputRate === this.outputRate) return new Float32Array(0);
    const output = this.drain(true);
    this.buffer = new Float32Array(0);
    return output;
  }

  private drain(final: boolean): Float32Array {
    const values: number[] = [];
    // One output sample per timestamp in [0, input duration); hence ceil for
    // finite inputs whose duration is not an exact destination sample count.
    const end = Math.ceil(this.totalInput / this.step);
    while (this.outputIndex < end) {
      const position = this.outputIndex * this.step;
      const center = Math.floor(position);
      if (!final && center + this.radius >= this.totalInput) break;
      const kernel = this.kernels[Math.round((position - center) * this.phaseCount)];
      let value = 0;
      for (let tap = 0; tap < kernel.length; tap++) {
        const source = center + tap - this.radius + 1;
        if (source >= 0 && source < this.totalInput) {
          value += this.buffer[source - this.bufferStart] * kernel[tap];
        }
      }
      values.push(value);
      this.outputIndex++;
    }
    const retainFrom = Math.max(0, Math.floor(this.outputIndex * this.step) - this.radius);
    const discard = Math.min(this.buffer.length, Math.max(0, retainFrom - this.bufferStart));
    if (discard > 0) {
      this.buffer = this.buffer.slice(discard);
      this.bufferStart += discard;
    }
    return Float32Array.from(values);
  }
}

/** Collects 100 ms mono frames by default, retaining a final partial frame. */
export class PcmFramer {
  private pending: Int16Array;
  private length = 0;

  constructor(private readonly frameSamples = 2_400) {
    if (!Number.isSafeInteger(frameSamples) || frameSamples <= 0) {
      throw new RangeError('Frame size must be a positive integer');
    }
    this.pending = new Int16Array(frameSamples);
  }

  push(input: Float32Array): Int16Array[] {
    const frames: Int16Array[] = [];
    for (let index = 0; index < input.length; index++) {
      const value = Number.isNaN(input[index]) ? 0 : Math.max(-1, Math.min(1, input[index]));
      this.pending[this.length++] = Math.round(value * (value < 0 ? 32_768 : 32_767));
      if (this.length === this.frameSamples) {
        frames.push(this.pending);
        this.pending = new Int16Array(this.frameSamples);
        this.length = 0;
      }
    }
    return frames;
  }

  flush(): Int16Array | null {
    if (this.length === 0) return null;
    const frame = this.pending.slice(0, this.length);
    this.pending = new Int16Array(this.frameSamples);
    this.length = 0;
    return frame;
  }
}

export type VadEvent =
  | { type: 'start'; sampleOffset: number }
  | { type: 'frame'; pcm: Int16Array }
  | { type: 'commit' };

export interface EnergyVadOptions {
  sampleRate?: number;
  /** Normalized root-mean-square amplitude required to begin/continue speech. */
  threshold?: number;
  preRollMs?: number;
  silenceMs?: number;
  maxSegmentMs?: number;
}

export class EnergyVad {
  private readonly threshold: number;
  private readonly preRollSamples: number;
  private readonly silenceSamples: number;
  private readonly maxSegmentSamples: number;
  private preRoll: Int16Array[] = [];
  private preRollLength = 0;
  private active = false;
  private segmentLength = 0;
  private silentLength = 0;
  private processedSamples = 0;

  constructor(options: EnergyVadOptions = {}) {
    const sampleRate = options.sampleRate ?? 24_000;
    this.threshold = options.threshold ?? 0.015;
    const preRollMs = options.preRollMs ?? 200;
    const silenceMs = options.silenceMs ?? 700;
    const maxSegmentMs = options.maxSegmentMs ?? 20_000;
    if (
      !Number.isFinite(sampleRate) ||
      sampleRate <= 0 ||
      !Number.isFinite(this.threshold) ||
      this.threshold < 0 ||
      this.threshold > 1 ||
      !Number.isFinite(preRollMs) ||
      preRollMs < 0 ||
      !Number.isFinite(silenceMs) ||
      silenceMs <= 0 ||
      !Number.isFinite(maxSegmentMs) ||
      maxSegmentMs <= 0
    ) {
      throw new RangeError('Invalid energy VAD configuration');
    }
    this.preRollSamples = Math.round((sampleRate * preRollMs) / 1_000);
    this.silenceSamples = Math.max(1, Math.round((sampleRate * silenceMs) / 1_000));
    this.maxSegmentSamples = Math.max(1, Math.round((sampleRate * maxSegmentMs) / 1_000));
    if (this.preRollSamples >= this.maxSegmentSamples) {
      throw new RangeError('Pre-roll must be shorter than the maximum segment');
    }
  }

  push(frame: Int16Array): VadEvent[] {
    if (frame.length === 0) return [];
    const frameStart = this.processedSamples;
    this.processedSamples += frame.length;
    let energy = 0;
    for (const sample of frame) energy += (sample / 32_768) ** 2;
    const speech = Math.sqrt(energy / frame.length) > this.threshold;
    const events: VadEvent[] = [];
    let offset = 0;
    while (offset < frame.length) {
      if (!this.active) {
        if (!speech) {
          this.remember(frame.subarray(offset));
          break;
        }
        this.active = true;
        this.segmentLength = this.preRollLength;
        this.silentLength = 0;
        events.push({ type: 'start', sampleOffset: frameStart + offset - this.preRollLength });
        for (const pcm of this.preRoll) events.push({ type: 'frame', pcm });
        this.preRoll = [];
        this.preRollLength = 0;
      }
      if (speech) this.silentLength = 0;
      const take = Math.min(
        frame.length - offset,
        this.maxSegmentSamples - this.segmentLength,
        speech ? Infinity : this.silenceSamples - this.silentLength,
      );
      events.push({ type: 'frame', pcm: frame.slice(offset, offset + take) });
      offset += take;
      this.segmentLength += take;
      if (!speech) this.silentLength += take;
      if (
        this.segmentLength >= this.maxSegmentSamples ||
        this.silentLength >= this.silenceSamples
      ) {
        events.push({ type: 'commit' });
        this.active = false;
        this.segmentLength = 0;
        this.silentLength = 0;
      }
    }
    return events;
  }

  /** Ends the last utterance even when the microphone stops before trailing silence. */
  flush(): VadEvent[] {
    const events: VadEvent[] = this.active ? [{ type: 'commit' }] : [];
    this.reset();
    return events;
  }

  reset(): void {
    this.preRoll = [];
    this.preRollLength = 0;
    this.active = false;
    this.segmentLength = 0;
    this.silentLength = 0;
    this.processedSamples = 0;
  }

  private remember(frame: Int16Array): void {
    if (this.preRollSamples === 0) return;
    this.preRoll.push(frame.slice());
    this.preRollLength += frame.length;
    while (this.preRollLength > this.preRollSamples) {
      const first = this.preRoll[0];
      const excess = this.preRollLength - this.preRollSamples;
      if (excess >= first.length) {
        this.preRoll.shift();
        this.preRollLength -= first.length;
      } else {
        this.preRoll[0] = first.slice(excess);
        this.preRollLength -= excess;
      }
    }
  }
}
