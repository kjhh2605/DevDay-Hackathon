import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'dotenv';
import { workspaceRoot } from './environment.js';

const envPath = resolve(workspaceRoot, '.env.local');
for (const path of ['.env.local', '.env.deploy.local', '.local/probe']) {
  const check = spawnSync('git', ['check-ignore', '--quiet', '--no-index', path], {
    cwd: workspaceRoot,
  });
  if (check.status !== 0) throw new Error(`Add ${path} to .gitignore before local setup.`);
}
if (!existsSync(envPath)) {
  const template = readFileSync(resolve(workspaceRoot, '.env.example'), 'utf8');
  const contents = template
    .replace('REPLACE_WITH_GENERATED_LOCAL_PASSWORD', randomBytes(24).toString('hex'))
    .replace(
      'REPLACE_WITH_ABSOLUTE_MEDIA_DIR',
      JSON.stringify(resolve(workspaceRoot, '.local/media')),
    );
  writeFileSync(envPath, contents, { flag: 'wx', mode: 0o600 });
  console.log('Created .env.local (0600). Add OPENAI_API_KEY for live AI validation.');
} else {
  console.log('Preserved existing .env.local; no values or passwords were changed.');
}
const env = { ...parse(readFileSync(envPath)), ...process.env };
if (!env.DB_PASSWORD || env.DB_PASSWORD.startsWith('REPLACE_'))
  throw new Error('Set DB_PASSWORD in .env.local. Existing values are never replaced.');
if (!env.MEDIA_LOCAL_DIR || !isAbsolute(env.MEDIA_LOCAL_DIR))
  throw new Error('MEDIA_LOCAL_DIR must be an absolute directory path.');
mkdirSync(env.MEDIA_LOCAL_DIR, { recursive: true, mode: 0o700 });
mkdirSync(resolve(workspaceRoot, '.local/certs'), { recursive: true, mode: 0o700 });
console.log(
  'Local media and certificate directories are ready. Run pnpm dev:services, then pnpm db:migrate:local.',
);
