export const SAMPLE_RATE = 24_000;

// OpenAI speech response_format=pcm: signed 16-bit LE, 24 kHz, mono.
export function pcmToWav(pcm) {
  if (!pcm.length || pcm.length % 2) throw new Error('비어 있거나 불완전한 PCM16 응답입니다.');
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF');
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(pcm.length, 40);
  wav.set(pcm, 44);
  return wav;
}

export function inspectWav(wav) {
  const fail = () => {
    throw new Error('24,000 Hz · mono · signed PCM16 LE WAV 파일이 아니거나 손상되었습니다.');
  };
  if (
    wav.length < 44 ||
    wav.toString('ascii', 0, 4) !== 'RIFF' ||
    wav.toString('ascii', 8, 12) !== 'WAVE' ||
    wav.readUInt32LE(4) !== wav.length - 8
  )
    fail();
  let format;
  let pcm;
  let offset = 12;
  while (offset < wav.length) {
    if (offset + 8 > wav.length) fail();
    const name = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size + (size % 2) > wav.length) fail();
    if (name === 'fmt ') {
      if (format || size < 16) fail();
      format = wav.subarray(start, start + size);
    }
    if (name === 'data') {
      if (pcm) fail();
      pcm = wav.subarray(start, start + size);
    }
    offset = start + size + (size % 2);
  }
  if (
    !format ||
    !pcm?.length ||
    pcm.length % 2 ||
    format.readUInt16LE(0) !== 1 ||
    format.readUInt16LE(2) !== 1 ||
    format.readUInt32LE(4) !== SAMPLE_RATE ||
    format.readUInt32LE(8) !== SAMPLE_RATE * 2 ||
    format.readUInt16LE(12) !== 2 ||
    format.readUInt16LE(14) !== 16
  )
    fail();
  let peak = 0;
  let energy = 0;
  for (let i = 0; i < pcm.length; i += 2) {
    const value = pcm.readInt16LE(i) / 32768;
    peak = Math.max(peak, Math.abs(value));
    energy += value * value;
  }
  if (peak === 0) throw new Error('음성이 없는 무음 WAV입니다.');
  return {
    sampleRate: SAMPLE_RATE,
    channels: 1,
    bitsPerSample: 16,
    encoding: 'pcm_s16le',
    durationSeconds: pcm.length / (SAMPLE_RATE * 2),
    peak,
    rms: Math.sqrt(energy / (pcm.length / 2)),
    bytes: wav.length,
  };
}
