import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseConfig } from '../src/config.js';

const minimum = { AI_MODE: 'mock', DB_PASSWORD: 'local-test-only' };
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('server configuration', () => {
  it('supports local mock without OpenAI or AWS credentials and parses false literally', () => {
    const config = parseConfig(
      { ...minimum, SESSION_COOKIE_SECURE: 'false', NODE_ENV: 'production' },
      { workspaceRoot: '/workspace' },
    );
    expect(config.sessionCookieSecure).toBe(false);
    expect(config.appEnv).toBe('local');
    expect(config.nodeEnv).toBe('production');
    expect(config.media.localDir).toBe('/workspace/.local/media');
    expect(config.openai.apiKey).toBeUndefined();
    expect(config.media.bucket).toBeUndefined();
  });

  it.each([
    ['SESSION_COOKIE_SECURE', '0'],
    ['PORT', '70000'],
    ['DB_PORT', '3.5'],
    ['PORT', '0'],
    ['AI_MODE', 'offline'],
    ['APP_ENV', 'production'],
    ['DB_SSL_MODE', 'require'],
    ['MEDIA_DRIVER', 'memory'],
    ['MEDIA_LOCAL_DIR', '../escape'],
    ['LOCAL_WEB_ORIGIN', 'http://localhost:5173/private'],
  ])('rejects invalid %s without echoing its value', (key, input) => {
    expect(() => parseConfig({ ...minimum, [key]: input })).toThrow(ConfigError);
    try {
      parseConfig({ ...minimum, [key]: input });
    } catch (error) {
      expect((error as Error).message).toContain(key);
    }
  });

  it('reports missing secrets without displaying supplied secret values', () => {
    expect(() => parseConfig({ AI_MODE: 'live', DB_PASSWORD: 'hidden-db-password' })).toThrow(
      'OPENAI_API_KEY',
    );
    try {
      parseConfig({
        AI_MODE: 'unknown-sensitive-value',
        DB_PASSWORD: 'hidden-db-password',
        OPENAI_API_KEY: 'hidden-api-key',
      });
    } catch (error) {
      expect((error as Error).message).not.toContain('hidden-db-password');
      expect((error as Error).message).not.toContain('hidden-api-key');
      expect((error as Error).message).not.toContain('unknown-sensitive-value');
    }
    expect(() => parseConfig({ AI_MODE: 'mock' })).toThrow('DB_PASSWORD');
  });

  it('requires HTTPS and Secure cookies for LAN and aligns the web port', () => {
    expect(() => parseConfig({ ...minimum, LOCAL_WEB_ORIGIN: 'http://192.168.0.5:5173' })).toThrow(
      'HTTPS',
    );
    expect(() => parseConfig({ ...minimum, LOCAL_WEB_ORIGIN: 'https://192.168.0.5:5173' })).toThrow(
      'SESSION_COOKIE_SECURE',
    );
    expect(() => parseConfig({ ...minimum, WEB_PORT: '5174' })).toThrow('LOCAL_WEB_ORIGIN');
    const config = parseConfig({
      ...minimum,
      LOCAL_WEB_ORIGIN: 'https://192.168.0.5:5173',
      SESSION_COOKIE_SECURE: 'true',
    });
    expect(config.sessionCookieSecure).toBe(true);
  });

  it('requires explicit S3, live AI and verified TLS in AWS', () => {
    expect(() => parseConfig({ ...minimum, APP_ENV: 'aws' })).toThrow('MEDIA_DRIVER');
    const config = parseConfig({
      ...minimum,
      APP_ENV: 'aws',
      AI_MODE: 'live',
      OPENAI_API_KEY: 'test-only-key',
      MEDIA_DRIVER: 's3',
      MEDIA_BUCKET: 'private-bucket',
      AWS_REGION: 'ap-northeast-2',
      DB_SSL_MODE: 'verify-full',
      DB_SSL_CA_PATH: '/app/certs/rds.pem',
      SESSION_COOKIE_SECURE: 'true',
    });
    expect(config.database.sslMode).toBe('verify-full');
    expect(config.media.driver).toBe('s3');
    expect(() => parseConfig({ ...minimum, DB_SSL_MODE: 'verify-full' })).toThrow('DB_SSL_CA_PATH');
  });

  it('loads the workspace root env from a package directory and preserves explicit overrides', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devday-env-'));
    temporary.push(root);
    const cwd = join(root, 'apps/api');
    await mkdir(cwd, { recursive: true });
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    await writeFile(
      join(root, '.env.local'),
      'AI_MODE=mock\nDB_PASSWORD="file-password"\nPORT=3001\n',
    );
    const config = loadConfig({ cwd, env: { PORT: '3010' } });
    expect(config.port).toBe(3010);
    expect(config.database.password).toBe('file-password');
    expect(config.workspaceRoot).toBe(root);
    await writeFile(
      join(root, '.env.test.local'),
      'AI_MODE=mock\nDB_PASSWORD=selected-password\nPORT=3020\n',
    );
    expect(loadConfig({ cwd, env: {}, envFile: '.env.test.local' }).port).toBe(3020);
    expect(() => loadConfig({ cwd, env: {}, envFile: 'missing' })).toThrow('ENV_FILE');
  });
});
