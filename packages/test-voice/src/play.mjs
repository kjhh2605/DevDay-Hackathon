import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { inspectWav } from './wav.mjs';

export function playFile(path, volume, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/afplay', ['-v', String(volume), path], {
      stdio: 'inherit',
      signal,
    });
    child.once('error', reject);
    child.once('exit', (code, killedBy) => {
      if (code === 0) resolve();
      else reject(new Error(`afplay 실패: ${killedBy ?? code}`));
    });
  });
}

export async function playSamples({
  paths,
  delay = 3,
  gap = 2,
  repeat = 1,
  volume = 1,
  signal,
  platform = process.platform,
  play = playFile,
  wait = setTimeout,
  log = console.log,
}) {
  if (platform !== 'darwin') throw new Error('재생은 macOS의 afplay가 필요합니다.');
  if (
    !paths.length ||
    !Number.isInteger(repeat) ||
    repeat < 1 ||
    repeat > 100 ||
    !Number.isFinite(delay) ||
    delay < 0 ||
    delay > 3600 ||
    !Number.isFinite(gap) ||
    gap < 0 ||
    gap > 3600 ||
    !Number.isFinite(volume) ||
    volume < 0 ||
    volume > 1
  )
    throw new Error('잘못된 재생 옵션입니다.');
  // Validate the entire playlist before making any sound.
  for (const path of paths) inspectWav(await readFile(path));
  log(
    `macOS 기본 출력으로 ${delay}초 후 재생합니다. 출력=BlackHole, 서비스 입력=BlackHole을 확인하세요. Ctrl+C로 중지합니다.`,
  );
  await wait(delay * 1000, undefined, { signal });
  for (let round = 0; round < repeat; round++) {
    for (const path of paths) {
      signal?.throwIfAborted();
      log(`재생 ${round + 1}/${repeat}: ${path}`);
      await play(path, volume, signal);
      // Include trailing silence so the service can finish VAD/segment commit.
      await wait(gap * 1000, undefined, { signal });
    }
  }
}
