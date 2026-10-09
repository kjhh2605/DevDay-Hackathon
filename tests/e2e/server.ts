import { spawn, type ChildProcess } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { config as loadEnv } from 'dotenv';
import { loadConfig } from '../../apps/api/src/config.js';
import { createDatabase } from '../../apps/api/src/db/client.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
loadEnv({ path: resolve(root, '.env.local'), quiet: true });
const apiPort = Number(process.env.E2E_API_PORT ?? 4101);
const webPort = Number(process.env.E2E_WEB_PORT ?? 5174);
const sourceDatabaseName = process.env.DB_NAME ?? 'devday_study';
const databaseName = process.env.E2E_DB_NAME ?? `${sourceDatabaseName}_e2e`;
if (
  !/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(databaseName) ||
  !databaseName.endsWith('_e2e') ||
  databaseName === sourceDatabaseName
) {
  throw new Error('E2E_DB_NAME must be a separate PostgreSQL identifier ending in _e2e.');
}
const env = {
  ...process.env,
  NODE_ENV: 'test',
  APP_ENV: 'local',
  DB_NAME: databaseName,
  AI_MODE: 'mock',
  OPENAI_API_KEY: '',
  API_HOST: '127.0.0.1',
  PORT: String(apiPort),
  WEB_PORT: String(webPort),
  LOCAL_WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
  LOCAL_TLS_CERT: '',
  LOCAL_TLS_KEY: '',
  SESSION_COOKIE_SECURE: 'false',
  MEDIA_DRIVER: 'filesystem',
  MEDIA_LOCAL_DIR: resolve(root, '.local/e2e-media'),
};
const children = new Set<ChildProcess>();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
process.on('SIGTERM', () => stop());
process.on('SIGINT', () => stop());
function launch(args: string[], cwd = root) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit' });
  children.add(child);
  child.once('exit', (code, signal) => {
    children.delete(child);
    if (!stopping && (code !== 0 || signal)) stop(code ?? 1);
  });
  child.once('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  return child;
}
async function ensureIsolatedDatabase() {
  const admin = await createDatabase(loadConfig({ env: { ...env, DB_NAME: sourceDatabaseName } }));
  try {
    const existing = await admin.pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      databaseName,
    ]);
    if (!existing.rowCount) {
      // Identifier is validated above; only the dedicated E2E database is created.
      try {
        await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === '42P04')) throw error;
      }
    }
  } finally {
    await admin.close();
  }
}
async function migrate() {
  const child = launch(['--import', 'tsx', 'apps/api/src/db/migrate.ts']);
  await new Promise<void>((resolveMigration, reject) => {
    child.once('exit', (code) =>
      code === 0
        ? resolveMigration()
        : reject(new Error('E2E migration failed. Start local PostgreSQL with pnpm dev:services.')),
    );
    child.once('error', reject);
  });
}
async function waitForApi() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && !stopping) {
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/readyz`);
      if (response.ok) return;
    } catch {
      /* API is still starting. */
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error('E2E API did not become ready on /readyz.');
}
try {
  await ensureIsolatedDatabase();
  await migrate();
  launch([
    '--import',
    'tsx',
    process.env.E2E_FAILURE_MODE === 'true' ? 'tests/e2e/failure-api.ts' : 'apps/api/src/server.ts',
  ]);
  await waitForApi();
  const requireWeb = createRequire(resolve(root, 'apps/web/package.json'));
  const vite = resolve(dirname(requireWeb.resolve('vite/package.json')), 'bin/vite.js');
  launch([vite, '--host', '127.0.0.1'], resolve(root, 'apps/web'));
  console.info(
    'E2E environment: real PostgreSQL/API, AI_MODE=mock, dedicated E2E database/users/media directory.',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'E2E server startup failed.');
  stop(1);
}
