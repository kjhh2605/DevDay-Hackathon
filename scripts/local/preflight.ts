import { spawnSync } from 'node:child_process';
import { randomUUID, X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { loadConfig } from '../../apps/api/src/config.js';
import { workspaceRoot } from './environment.js';

const target = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'local';
if (!['local', 'lan', 'aws'].includes(target ?? '')) throw new Error('Use --target=local|lan|aws.');
if (target === 'aws') {
  const { awsPreflight } = await import('../deploy/preflight.js');
  await awsPreflight();
} else {
  await localPreflight(target === 'lan');
}

async function localPreflight(lan: boolean) {
  const failures: string[] = [];
  const check = async (name: string, work: () => Promise<string> | string) => {
    try {
      console.log(`PASS ${name}: ${await work()}`);
    } catch (error) {
      failures.push(name);
      console.error(`FAIL ${name}: ${error instanceof Error ? error.message : 'check failed'}`);
    }
  };
  await check('Node', () => {
    if (Number(process.versions.node.split('.')[0]) !== 24)
      throw new Error('Use the pinned Node 24 runtime.');
    return process.versions.node;
  });
  for (const [name, command, args] of [
    ['pnpm', 'pnpm', ['--version']],
    ['Docker daemon', 'docker', ['info', '--format', '{{.ServerVersion}}']],
    ['Docker Compose', 'docker', ['compose', 'version', '--short']],
  ] as const) {
    await check(name, () => {
      const result = spawnSync(command, [...args], { encoding: 'utf8', timeout: 15_000 });
      if (result.status !== 0) throw new Error(`Install/start ${name}; command did not succeed.`);
      const version = result.stdout.trim();
      if (name === 'pnpm' && version !== '10.33.2')
        throw new Error('Use pnpm 10.33.2 from packageManager.');
      return version;
    });
  }
  // Reuse the exact startup parser. Errors contain variable names, never secrets.
  const config = loadConfig({ cwd: workspaceRoot });
  if (config.appEnv !== 'local' || config.media.driver !== 'filesystem')
    throw new Error('Local preflight requires APP_ENV=local and MEDIA_DRIVER=filesystem.');
  console.log(
    `PASS environment: APP_ENV=${config.appEnv}, AI_MODE=${config.aiMode}; live key presence checked without a paid request.`,
  );
  await check('PostgreSQL and migration', async () => {
    const c = config.database;
    const pool = new Pool({
      host: c.host,
      port: c.port,
      database: c.name,
      user: c.user,
      password: c.password,
      connectionTimeoutMillis: 5_000,
      ssl:
        c.sslMode === 'verify-full'
          ? {
              ca: await readFile(c.sslCaPath!, 'utf8'),
              rejectUnauthorized: true,
              servername: c.host,
            }
          : false,
    });
    try {
      const result = await pool.query<{ server_version: string }>('SHOW server_version');
      const version = result.rows[0]!.server_version;
      if (!version.startsWith('17.')) throw new Error('Use PostgreSQL 17 for local acceptance.');
      const migration = await pool.query(
        "SELECT version FROM app_migrations WHERE version = '0001_initial'",
      );
      if (migration.rowCount !== 1) throw new Error('Run pnpm db:migrate:local.');
      return `version ${version}; 0001_initial applied`;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.startsWith('Use PostgreSQL') || error.message.startsWith('Run pnpm'))
      )
        throw error;
      throw new Error(
        'Connection or migration check failed. Run pnpm dev:services and pnpm db:migrate:local; verify DB_* values.',
      );
    } finally {
      await pool.end();
    }
  });
  await check('Media persistence directory', async () => {
    await mkdir(config.media.localDir, { recursive: true });
    const path = resolve(config.media.localDir, `.preflight-${randomUUID()}`);
    const bytes = Buffer.from(randomUUID());
    try {
      await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
      if (!(await readFile(path)).equals(bytes))
        throw new Error('Media read did not match written bytes.');
    } finally {
      await rm(path, { force: true });
    }
    return 'write/read/delete probe succeeded';
  });
  if (lan) {
    await check('LAN HTTPS certificate', async () => {
      const origin = new URL(config.webOrigin);
      if (origin.protocol !== 'https:' || !config.sessionCookieSecure)
        throw new Error(
          'Set LOCAL_WEB_ORIGIN=https://<LAN-host>:WEB_PORT and SESSION_COOKIE_SECURE=true.',
        );
      if (!config.tls.certPath || !config.tls.keyPath)
        throw new Error('Set LOCAL_TLS_CERT and LOCAL_TLS_KEY absolute paths.');
      const certificate = new X509Certificate(await readFile(config.tls.certPath));
      const key = createPrivateKey(await readFile(config.tls.keyPath));
      if (!certificate.publicKey.equals(createPublicKey(key)))
        throw new Error('Certificate and private key do not match.');
      const host = origin.hostname.replace(/^\[|\]$/g, '');
      if (!(isIP(host) ? certificate.checkIP(host) : certificate.checkHost(host)))
        throw new Error(
          'Certificate SAN does not cover LOCAL_WEB_ORIGIN host; issue it again for the current LAN host.',
        );
      if (
        Date.parse(certificate.validFrom) > Date.now() ||
        Date.parse(certificate.validTo) < Date.now()
      )
        throw new Error('Certificate is not currently valid.');
      return `certificate covers ${host}; browser trust and each physical microphone remain manual checks`;
    });
  }
  console.log('No OpenAI or AWS API calls were made. Preflight is not G3 acceptance.');
  if (failures.length) process.exitCode = 1;
}
