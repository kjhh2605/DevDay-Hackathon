import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pcmToWav, inspectWav } from './wav.mjs';
import { spacing, synthesizeWords, verifySpacing } from './spacing.mjs';

export const model = 'gpt-4o-mini-tts';
export const voice = 'coral';
const hash = (data) => createHash('sha256').update(data).digest('hex');

export async function synthesize(sample, apiKey, fetchImpl = fetch) {
  if (!apiKey?.trim())
    throw new Error('OPENAI_API_KEY를 환경변수 또는 저장소 .env.local에 설정하세요.');
  const response = await fetchImpl('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      voice,
      input: sample.text,
      response_format: 'pcm',
      instructions: `Speak in ${sample.language === 'en-ko' ? 'both English and Korean, switching languages exactly where the input switches. Pronounce Korean words and expressions naturally in Korean; do not translate them into English' : sample.language === 'ko' ? 'Korean' : 'English'} at a clear, natural conversational pace. ${sample.isolatedWord ? 'The input is a single vocabulary word. Say this word aloud clearly and audibly, even if it is a short article or preposition. Do not skip it or remain silent. ' : ''}Read the text exactly, preserving grammatical errors. Do not add words, music, or sound effects.`,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  // Never print response bodies or request headers: they may contain credentials/input.
  if (!response.ok)
    throw new Error(
      `OpenAI 음성 생성 실패 (HTTP ${response.status}). 키 권한, 잔액, 사용 한도를 확인하세요.`,
    );
  return Buffer.from(await response.arrayBuffer());
}

export async function generateSamples({
  selected,
  outDir,
  apiKey,
  force = false,
  speech = synthesize,
  log = console.log,
}) {
  await mkdir(outDir, { recursive: true });
  for (const sample of selected) {
    const path = join(outDir, `${sample.id}.wav`);
    const metadataPath = join(outDir, `${sample.id}.json`);
    if (!force) {
      let existing;
      try {
        existing = await readFile(path);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (existing) {
        inspectWav(existing);
        const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
        if (
          metadata.sha256 !== hash(existing) ||
          metadata.text !== sample.text ||
          metadata.model !== model ||
          metadata.voice !== voice
        )
          throw new Error(
            `${sample.id}: 파일/설정이 바뀌었습니다. 재생성을 원하면 --force를 사용하세요.`,
          );
        verifySpacing(existing, metadata);
        log(`재사용: ${path}`);
        continue;
      }
    }
    const spaced = await synthesizeWords({
      sample,
      apiKey,
      cacheDir: join(outDir, '.word-cache'),
      speech,
      model,
      voice,
      log,
    });
    const wav = pcmToWav(spaced.pcm);
    const audio = inspectWav(wav);
    const metadata = {
      ...sample,
      synthetic: true,
      provider: 'OpenAI',
      model,
      voice,
      createdAt: new Date().toISOString(),
      sha256: hash(wav),
      spacing,
      words: spaced.words,
      ...audio,
    };
    // Persist each sample separately so a later API failure keeps completed work.
    await writeFile(`${path}.tmp`, wav);
    await rename(`${path}.tmp`, path);
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    log(`생성: ${path} (${audio.durationSeconds.toFixed(2)}초)`);
  }
}
