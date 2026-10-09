import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { selectSamples } from './samples.mjs';
import { generateSamples } from './generate.mjs';
import { playSamples } from './play.mjs';
import { inspectWav } from './wav.mjs';
import { verifySpacing } from './spacing.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const help = `사용법: pnpm --filter @devday/test-voice <generate|play|verify|list> [옵션]
  --sample <id|all>  기본 all (list로 목록 확인)
  --out <directory> 기본 저장소 .local/test-voice (상대 경로는 현재 작업 디렉터리 기준)
  generate: --force (단어 캐시를 재사용해 간격을 다시 추첨하고 WAV 재생성)
  기본 단어 간격: 공백 기준 단어/어절 사이 무작위 1~10초 무음
  play: --delay <초=3> --gap <초=2> --repeat <횟수=1> --volume <0..1=1>
  --help
AI로 생성한 테스트 음성입니다. 재생은 macOS 기본 출력 장치를 사용합니다.`;

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      sample: { type: 'string' },
      out: { type: 'string' },
      force: { type: 'boolean' },
      delay: { type: 'string' },
      gap: { type: 'string' },
      repeat: { type: 'string' },
      volume: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  const [command] = positionals;
  if (values.help) console.log(help);
  else {
    if (positionals.length !== 1 || !['generate', 'play', 'verify', 'list'].includes(command))
      throw new Error(help);
    for (const key of Object.keys(values)) {
      if (
        (key === 'force' && command !== 'generate') ||
        (['delay', 'gap', 'repeat', 'volume'].includes(key) && command !== 'play')
      )
        throw new Error(`${command}에는 --${key} 옵션을 사용할 수 없습니다.`);
    }
    const selected = selectSamples(values.sample);
    const outDir = values.out ? resolve(values.out) : join(root, '.local/test-voice');
    const paths = selected.map((sample) => join(outDir, `${sample.id}.wav`));
    if (command === 'list')
      for (const sample of selected)
        console.log(`${sample.id} [${sample.language}] ${sample.purpose}\n  ${sample.text}`);
    if (command === 'generate') {
      let local = {};
      try {
        local = parseEnv(await readFile(join(root, '.env.local'), 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await generateSamples({
        selected,
        outDir,
        apiKey: process.env.OPENAI_API_KEY ?? local.OPENAI_API_KEY,
        force: values.force,
      });
    }
    if (command === 'verify')
      for (const path of paths) {
        const wav = await readFile(path);
        const metadata = JSON.parse(await readFile(path.replace(/\.wav$/, '.json'), 'utf8'));
        console.log(path, inspectWav(wav), verifySpacing(wav, metadata));
      }
    if (command === 'play') {
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      try {
        await playSamples({
          paths,
          signal: controller.signal,
          ...Object.fromEntries(
            ['delay', 'gap', 'repeat', 'volume']
              .filter((key) => values[key] !== undefined)
              .map((key) => [key, values[key].trim() === '' ? NaN : Number(values[key])]),
          ),
        });
      } finally {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
      }
    }
  }
} catch (error) {
  console.error(error.name === 'AbortError' ? '재생을 중지했습니다.' : error.message);
  process.exitCode = error.name === 'AbortError' ? 130 : 1;
}
