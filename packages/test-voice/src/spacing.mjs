import { randomInt, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectWav, pcmToWav, SAMPLE_RATE } from './wav.mjs';

export const spacing = { version: 1, unit: 'whitespace-word', minSeconds: 1, maxSeconds: 10 };

export function joinWords(parts, randomGapMs = () => randomInt(1000, 10001)) {
  if (!parts.length) throw new Error('합성할 단어가 없습니다.');
  const chunks = [];
  const words = [];
  let position = 0;
  for (let i = 0; i < parts.length; i++) {
    const { text, pcm } = parts[i];
    inspectWav(pcmToWav(pcm));
    const gapMs = i < parts.length - 1 ? randomGapMs() : 0;
    if (!Number.isInteger(gapMs) || (i < parts.length - 1 && (gapMs < 1000 || gapMs > 10000)))
      throw new Error('단어 간 무음은 1~10초여야 합니다.');
    const gapSamples = gapMs * (SAMPLE_RATE / 1000);
    words.push({
      text,
      startSample: position,
      endSample: position + pcm.length / 2,
      gapAfterSamples: gapSamples,
    });
    chunks.push(pcm, Buffer.alloc(gapSamples * 2));
    position += pcm.length / 2 + gapSamples;
  }
  return { pcm: Buffer.concat(chunks), words };
}

// Trim quiet padding produced by TTS; retain 10 ms around audible samples.
// The inserted inter-word zeros are exact; sub-threshold natural tails may remain.
export function trimWord(pcm) {
  let first = 0;
  let last = pcm.length / 2 - 1;
  while (first <= last && Math.abs(pcm.readInt16LE(first * 2)) < 16) first++;
  while (last >= first && Math.abs(pcm.readInt16LE(last * 2)) < 16) last--;
  if (first > last) throw new Error('합성 단어가 무음입니다.');
  return pcm.subarray(Math.max(0, first - 240) * 2, Math.min(pcm.length / 2, last + 241) * 2);
}

export async function synthesizeWords({
  sample,
  apiKey,
  cacheDir,
  speech,
  model,
  voice,
  force = false,
  log = console.log,
}) {
  await mkdir(cacheDir, { recursive: true });
  const tokens = sample.text.trim().split(/\s+/u);
  const parts = new Array(tokens.length);
  // Four bounded workers; each successful word is durable if a later call fails.
  let cursor = 0;
  let failure;
  await Promise.all(
    Array.from({ length: Math.min(4, tokens.length) }, async () => {
      while (!failure && cursor < tokens.length) {
        const index = cursor++;
        const text = tokens[index];
        const language = /[가-힣]/u.test(text) ? 'ko' : 'en';
        const key = createHash('sha256')
          .update(JSON.stringify({ version: spacing.version, text, language, model, voice }))
          .digest('hex');
        const path = join(cacheDir, `${key}.wav`);
        try {
          let cached;
          if (!force) {
            try {
              cached = await readFile(path);
            } catch (error) {
              if (error.code !== 'ENOENT') throw error;
            }
          }
          let pcm;
          if (cached) {
            inspectWav(cached);
            pcm = cached.subarray(44); // Only canonical pcmToWav output is cached here.
          } else {
            // A short-word TTS response can be silent. Retry only that invalid audio,
            // at most twice; HTTP/auth/rate-limit failures still fail immediately.
            for (let attempt = 0; attempt < 3; attempt++) {
              const raw = await speech({ ...sample, text, language, isolatedWord: true }, apiKey);
              try {
                pcm = trimWord(raw);
                break;
              } catch (error) {
                if (attempt === 2 || !error.message.includes('무음')) throw error;
                log(`무음 응답 재시도 ${attempt + 1}/2: ${sample.id} 단어 ${index + 1}`);
              }
            }
            const wav = pcmToWav(pcm);
            inspectWav(wav);
            const temp = `${path}.${index}.tmp`;
            await writeFile(temp, wav);
            await rename(temp, path);
          }
          parts[index] = { text, pcm };
          log(`단어 ${index + 1}/${tokens.length}: ${sample.id} (${cached ? '재사용' : '생성'})`);
        } catch (error) {
          failure ??= new Error(`${sample.id} 단어 ${index + 1} (${text}): ${error.message}`);
        }
      }
    }),
  );
  if (failure) throw failure;
  return joinWords(parts);
}

export function verifySpacing(wav, metadata) {
  inspectWav(wav);
  if (
    JSON.stringify(metadata.spacing) !== JSON.stringify(spacing) ||
    !Array.isArray(metadata.words)
  )
    throw new Error('단어 간격 메타데이터가 없습니다. --force로 새 형식으로 생성하세요.');
  const tokens = metadata.text.trim().split(/\s+/u);
  if (tokens.length !== metadata.words.length) throw new Error('단어 수가 일치하지 않습니다.');
  let expectedStart = 0;
  for (let i = 0; i < tokens.length; i++) {
    const word = metadata.words[i];
    const { startSample, endSample, gapAfterSamples } = word;
    if (
      word.text !== tokens[i] ||
      ![startSample, endSample, gapAfterSamples].every(Number.isInteger) ||
      startSample !== expectedStart ||
      endSample <= startSample ||
      (i === tokens.length - 1
        ? gapAfterSamples !== 0
        : gapAfterSamples < SAMPLE_RATE || gapAfterSamples > SAMPLE_RATE * 10)
    )
      throw new Error('단어 간격 메타데이터가 잘못되었습니다.');
    const silence = wav.subarray(44 + endSample * 2, 44 + (endSample + gapAfterSamples) * 2);
    if (silence.length !== gapAfterSamples * 2 || silence.some((value) => value !== 0))
      throw new Error('기록된 단어 간격에 무음이 아닌 데이터가 있습니다.');
    expectedStart = endSample + gapAfterSamples;
  }
  if (44 + expectedStart * 2 !== wav.length) throw new Error('단어 간격과 WAV 길이가 다릅니다.');
  return {
    words: tokens.length,
    gaps: Math.max(0, tokens.length - 1),
    minSeconds: 1,
    maxSeconds: 10,
  };
}
