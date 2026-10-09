import { spawnSync } from 'node:child_process';
import { readLocalEnvironment, workspaceRoot } from './environment.js';

const env = readLocalEnvironment();
// Bind-mounted media keeps the host user's ownership on Linux and macOS.
env.LOCAL_API_UID ??= String(process.getuid?.() ?? 1000);
env.LOCAL_API_GID ??= String(process.getgid?.() ?? 1000);
const action = process.argv[2] ?? 'up';
const project = env.COMPOSE_PROJECT_NAME ?? 'devday-study-local';
if (!/^[a-z0-9][a-z0-9_-]*$/.test(project))
  throw new Error('COMPOSE_PROJECT_NAME must be a valid lowercase Docker project name.');
for (const key of ['DB_NAME', 'DB_USER', 'DB_PASSWORD', 'MEDIA_LOCAL_DIR']) {
  if (!env[key] || env[key]?.startsWith('REPLACE_'))
    throw new Error(`Set ${key} in .env.local first.`);
}
const actions: Record<string, string[]> = {
  up: ['up', '-d', '--wait', 'postgres'],
  status: ['ps'],
  stop: ['stop'],
  api: ['--profile', 'production', 'up', '-d', '--wait', '--no-deps', 'api'],
  'restart-api': ['--profile', 'production', 'restart', 'api'],
  migrate: [
    '--profile',
    'production',
    'run',
    '--rm',
    '--no-deps',
    'api',
    'node',
    'apps/api/dist/db/migrate.js',
  ],
};
const args = actions[action];
if (!args)
  throw new Error(`Unknown services action: ${action}. Use ${Object.keys(actions).join(', ')}.`);
const result = spawnSync(
  'docker',
  [
    'compose',
    '--project-directory',
    workspaceRoot,
    '--project-name',
    project,
    '-f',
    'compose.yaml',
    ...args,
  ],
  {
    cwd: workspaceRoot,
    env,
    stdio: 'inherit',
  },
);
process.exitCode = result.status ?? 1;
