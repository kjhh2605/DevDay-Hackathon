/** Inspect deliverables without changing the product or recorded source data. */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const ffmpeg = process.env.FFMPEG || '/opt/homebrew/bin/ffmpeg';
const ffprobe = process.env.FFPROBE || '/opt/homebrew/bin/ffprobe';
const names = ['overview', 'experience', 'conversation', 'assistant', 'review', 'reuse'];
const report = [];
await mkdir('.local/landing/qa', { recursive: true });
for (const name of names) {
  const file = resolve('apps/web/public/media/landing', `${name}.mp4`);
  const probe = spawnSync(
    ffprobe,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration,size:stream=codec_name,codec_type,width,height,pix_fmt,r_frame_rate',
      '-of',
      'json',
      file,
    ],
    { encoding: 'utf8' },
  );
  if (probe.status !== 0) throw new Error(probe.stderr);
  const info = JSON.parse(probe.stdout);
  const stream = info.streams.find((s) => s.codec_type === 'video');
  const duration = Number(info.format.duration);
  if (
    stream.codec_name !== 'h264' ||
    stream.width !== 1600 ||
    stream.height !== 900 ||
    stream.pix_fmt !== 'yuv420p' ||
    stream.r_frame_rate !== '30/1'
  )
    throw new Error(`Invalid video format ${name}`);
  if (name === 'overview' ? duration < 25 || duration > 45 : duration < 8 || duration > 14)
    throw new Error(`Invalid duration ${name}`);
  const bytes = await readFile(file);
  let offset = 0;
  const atoms = [];
  while (offset + 8 <= bytes.length) {
    let size = bytes.readUInt32BE(offset);
    const kind = bytes.toString('ascii', offset + 4, offset + 8);
    if (size === 1) {
      size = Number(bytes.readBigUInt64BE(offset + 8));
    }
    if (size <= 0) break;
    atoms.push({ kind, offset, size });
    offset += size;
  }
  if (atoms.find((a) => a.kind === 'moov')?.offset >= atoms.find((a) => a.kind === 'mdat')?.offset)
    throw new Error(`Faststart absent ${name}`);
  const decode = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-f', 'null', '-'], {
    encoding: 'utf8',
  });
  if (decode.status !== 0 || decode.stderr.trim())
    throw new Error(`Decode error ${name}: ${decode.stderr}`);
  const poster = await stat(resolve('apps/web/public/media/landing', `${name}.jpg`));
  const captions = await readFile(resolve('apps/web/public/media/landing', `${name}.vtt`), 'utf8');
  if (!captions.startsWith('WEBVTT')) throw new Error(`Invalid captions ${name}`);
  const toSeconds = (value) => value.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
  let previousEnd = 0;
  for (const cue of captions.matchAll(
    /(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})/g,
  )) {
    const start = toSeconds(cue[1]);
    const end = toSeconds(cue[2]);
    if (start < previousEnd - 0.001 || end <= start || end > duration + 0.04)
      throw new Error(`Invalid caption timing ${name}`);
    previousEnd = end;
  }
  for (const [index, ratio] of [0.1, 0.5, 0.9].entries()) {
    const frame = spawnSync(
      ffmpeg,
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        String(duration * ratio),
        '-i',
        file,
        '-frames:v',
        '1',
        resolve('.local/landing/qa', `${name}-${index}.png`),
      ],
      { encoding: 'utf8' },
    );
    if (frame.status !== 0) throw new Error(frame.stderr);
  }
  report.push({
    name,
    duration,
    bytes: Number(info.format.size),
    codec: stream.codec_name,
    width: stream.width,
    height: stream.height,
    pixelFormat: stream.pix_fmt,
    fps: 30,
    audioStreams: info.streams.filter((s) => s.codec_type === 'audio').length,
    faststart: true,
    decode: 'passed',
    posterBytes: poster.size,
    captions: 'present',
  });
}
const result = {
  checkedAt: new Date().toISOString(),
  totalVideoBytes: report.reduce((s, r) => s + r.bytes, 0),
  files: report,
};
await writeFile('.local/landing/qa/verification.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
