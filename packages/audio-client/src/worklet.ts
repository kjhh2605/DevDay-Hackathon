import { PcmFramer, StreamingResampler } from './dsp.js';

/** The same DSP classes are exercised by unit tests and run in the audio thread. */
export function captureWorkletSource(): string {
  return `
const StreamingResampler = ${StreamingResampler.toString()};
const PcmFramer = ${PcmFramer.toString()};
class DevdayCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'start') {
        this.resampler = new StreamingResampler(sampleRate, 24000);
        this.framer = new PcmFramer(2400);
        this.active = true;
      } else if (data.type === 'flush') {
        this.active = false;
        if (this.resampler && this.framer) {
          this.sendFrames(this.framer.push(this.resampler.flush()));
          const tail = this.framer.flush();
          if (tail) this.sendFrames([tail]);
          this.resampler = null;
          this.framer = null;
        }
        this.port.postMessage({ type: 'flushed', requestId: data.requestId });
      }
    };
  }
  sendFrames(frames) {
    for (const pcm of frames) this.port.postMessage({ type: 'frame', pcm: pcm.buffer }, [pcm.buffer]);
  }
  process(inputs) {
    if (!this.active || !inputs[0] || !inputs[0][0]) return true;
    const channels = inputs[0];
    let mono = channels[0];
    if (channels.length > 1) {
      mono = new Float32Array(channels[0].length);
      for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
    }
    this.sendFrames(this.framer.push(this.resampler.push(mono)));
    // Outputs remain zero: microphone audio is never played back.
    return true;
  }
}
registerProcessor('devday-capture', DevdayCaptureProcessor);
`;
}
