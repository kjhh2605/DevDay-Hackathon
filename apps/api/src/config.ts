import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { parseEnv } from 'node:util';

export type Environment = Readonly<Record<string, string | undefined>>;
export interface ApiConfig {
  appEnv: 'local' | 'aws';
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  webPort: number;
  webOrigin: string;
  sessionCookieSecure: boolean;
  aiMode: 'mock' | 'live';
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    sslMode: 'disable' | 'verify-full';
    sslCaPath?: string;
  };
  openai: {
    apiKey?: string;
    textModel: string;
    decisionModel: string;
    decisionTimeoutMs: string;
    decisionConfidence: string;
    liveTranscribeModel: string;
    correctionModel: string;
    imageModel: string;
  };
  media: { driver: 'filesystem' | 's3'; localDir: string; bucket?: string; region?: string };
  tls: { certPath?: string; keyPath?: string };
  workspaceRoot: string;
}

export interface ConfigIssue {
  variable: string;
  instruction: string;
}
export class ConfigError extends Error {
  constructor(readonly issues: readonly ConfigIssue[]) {
    // Do not include input values: they may contain passwords, keys or signed URLs.
    super(issues.map(({ variable, instruction }) => `${variable}: ${instruction}`).join('\n'));
    this.name = 'ConfigError';
  }
}

/** Pure validation. Importing this module never connects to a service or reads credentials. */
export function parseConfig(env: Environment, options: { workspaceRoot?: string } = {}): ApiConfig {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const issues: ConfigIssue[] = [];
  const issue = (variable: string, instruction: string) => {
    issues.push({ variable, instruction });
  };
  const value = (key: string, fallback?: string): string => env[key] ?? fallback ?? '';
  const required = (key: string, fallback?: string): string => {
    const result = value(key, fallback);
    if (!result.trim() || /^REPLACE_/i.test(result))
      issue(key, 'Set a non-empty value for this environment.');
    return result;
  };
  const optional = (key: string): string | undefined => value(key).trim() || undefined;
  const enumeration = <T extends string>(key: string, choices: readonly T[], fallback: T): T => {
    const result = value(key, fallback);
    if (!choices.includes(result as T)) issue(key, `Use one of: ${choices.join(', ')}.`);
    return result as T;
  };
  const port = (key: string, fallback: number): number => {
    const input = value(key, String(fallback));
    const result = Number(input);
    if (!/^\d+$/.test(input) || !Number.isInteger(result) || result < 1 || result > 65535) {
      issue(key, 'Use an integer port from 1 to 65535.');
    }
    return result;
  };
  const absolutePath = (key: string, fallback?: string): string | undefined => {
    const result = fallback === undefined ? optional(key) : required(key, fallback);
    if (result && !isAbsolute(result)) issue(key, 'Use an absolute filesystem path.');
    return result;
  };
  const appEnv = enumeration('APP_ENV', ['local', 'aws'], 'local');
  const aiMode = enumeration('AI_MODE', ['live', 'mock'], 'live');
  const mediaDriver = enumeration('MEDIA_DRIVER', ['filesystem', 's3'], 'filesystem');
  const sslMode = enumeration('DB_SSL_MODE', ['disable', 'verify-full'], 'disable');
  const secure = enumeration('SESSION_COOKIE_SECURE', ['true', 'false'], 'false') === 'true';
  const webPort = port('WEB_PORT', 5173);
  const webOrigin = value('LOCAL_WEB_ORIGIN', 'http://localhost:5173');
  let parsedOrigin: URL | undefined;
  try {
    parsedOrigin = new URL(webOrigin);
    if (
      !['http:', 'https:'].includes(parsedOrigin.protocol) ||
      parsedOrigin.origin !== webOrigin ||
      parsedOrigin.username ||
      parsedOrigin.password
    )
      throw new Error('Invalid origin');
  } catch {
    issue(
      'LOCAL_WEB_ORIGIN',
      'Use an http(s) origin without a path, credentials, query or fragment.',
    );
  }
  if (parsedOrigin && appEnv === 'local') {
    const originPort = Number(
      parsedOrigin.port || (parsedOrigin.protocol === 'https:' ? '443' : '80'),
    );
    if (originPort !== webPort) issue('LOCAL_WEB_ORIGIN', 'Set the origin port to WEB_PORT.');
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsedOrigin.hostname);
    if (!loopback && parsedOrigin.protocol !== 'https:') {
      issue('LOCAL_WEB_ORIGIN', 'Use HTTPS for LAN access.');
    }
  }
  if (parsedOrigin?.protocol === 'https:' && !secure) {
    issue('SESSION_COOKIE_SECURE', 'Use true when LOCAL_WEB_ORIGIN uses HTTPS.');
  }
  const apiKey = optional('OPENAI_API_KEY');
  if (aiMode === 'live' && (!apiKey || /^REPLACE_/i.test(apiKey))) {
    issue(
      'OPENAI_API_KEY',
      'Set the server API key, or explicitly use AI_MODE=mock for development tests.',
    );
  }
  const sslCaPath = absolutePath('DB_SSL_CA_PATH');
  if (sslMode === 'verify-full' && !sslCaPath)
    issue('DB_SSL_CA_PATH', 'Set the absolute CA certificate path for verify-full.');
  const certPath = absolutePath('LOCAL_TLS_CERT');
  const keyPath = absolutePath('LOCAL_TLS_KEY');
  if (Boolean(certPath) !== Boolean(keyPath))
    issue('LOCAL_TLS_CERT/LOCAL_TLS_KEY', 'Set both certificate and key paths together.');
  const bucket = optional('MEDIA_BUCKET');
  const region = optional('AWS_REGION');
  if (mediaDriver === 's3') {
    if (!bucket) issue('MEDIA_BUCKET', 'Set the private S3 bucket name.');
    if (!region) issue('AWS_REGION', 'Set the S3 AWS region.');
  }
  if (appEnv === 'aws') {
    if (mediaDriver !== 's3') issue('MEDIA_DRIVER', 'Use s3 for APP_ENV=aws.');
    if (aiMode !== 'live') issue('AI_MODE', 'Use live for APP_ENV=aws.');
    if (!secure) issue('SESSION_COOKIE_SECURE', 'Use true for APP_ENV=aws.');
    if (sslMode !== 'verify-full') issue('DB_SSL_MODE', 'Use verify-full for APP_ENV=aws.');
    if (!sslCaPath)
      issue('DB_SSL_CA_PATH', 'Set the absolute RDS CA certificate path for APP_ENV=aws.');
  }
  const config: ApiConfig = {
    appEnv,
    nodeEnv: enumeration('NODE_ENV', ['development', 'test', 'production'], 'development'),
    host: required('API_HOST', '127.0.0.1'),
    port: port('PORT', 3000),
    webPort,
    webOrigin,
    sessionCookieSecure: secure,
    aiMode,
    workspaceRoot,
    database: {
      host: required('DB_HOST', '127.0.0.1'),
      port: port('DB_PORT', 5432),
      name: required('DB_NAME', 'devday_study'),
      user: required('DB_USER', 'devday_app'),
      password: required('DB_PASSWORD'),
      sslMode,
      ...(sslCaPath ? { sslCaPath } : {}),
    },
    openai: {
      ...(apiKey ? { apiKey } : {}),
      textModel: required('OPENAI_TEXT_MODEL', 'gpt-6-luna'),
      decisionModel: required('OPENAI_DECISION_MODEL', 'gpt-6-luna'),
      decisionTimeoutMs: required('SPEECH_DECISION_TIMEOUT_MS', '2000'),
      decisionConfidence: required('SPEECH_DECISION_CONFIDENCE', '0.85'),
      liveTranscribeModel: required('OPENAI_LIVE_TRANSCRIBE_MODEL', 'gpt-live-transcribe'),
      correctionModel: required('OPENAI_CORRECTION_MODEL', 'gpt-transcribe'),
      imageModel: required('OPENAI_IMAGE_MODEL', 'gpt-image-2.5-flare-2026-09-08'),
    },
    media: {
      driver: mediaDriver,
      localDir: absolutePath('MEDIA_LOCAL_DIR', resolve(workspaceRoot, '.local/media')) ?? '',
      ...(bucket ? { bucket } : {}),
      ...(region ? { region } : {}),
    },
    tls: { ...(certPath ? { certPath } : {}), ...(keyPath ? { keyPath } : {}) },
  };
  for (const [key, text, min, max] of [
    ['SPEECH_DECISION_TIMEOUT_MS', config.openai.decisionTimeoutMs, 1, 10000],
    ['SPEECH_DECISION_CONFIDENCE', config.openai.decisionConfidence, 0, 1],
  ] as const)
    if (!Number.isFinite(Number(text)) || Number(text) < min || Number(text) > max)
      issue(key, `Use a number from ${min} to ${max}.`);
  if (issues.length) throw new ConfigError(issues);
  return config;
}

export interface LoadConfigOptions {
  env?: Environment;
  envFile?: string;
  cwd?: string;
}

export function findWorkspaceRoot(start = process.cwd()): string {
  let current = resolve(start);
  for (;;) {
    if (existsSync(resolve(current, 'pnpm-workspace.yaml')) || existsSync(resolve(current, '.git')))
      return current;
    const parent = dirname(current);
    if (parent === current)
      throw new ConfigError([
        { variable: 'WORKSPACE_ROOT', instruction: 'Run this command from the project workspace.' },
      ]);
    current = parent;
  }
}

/** Loads only when called, preserves explicitly supplied environment values and never mutates process.env. */
export function loadEnvironment(options: LoadConfigOptions = {}): {
  env: Environment;
  workspaceRoot: string;
} {
  const workspaceRoot = findWorkspaceRoot(options.cwd);
  const envFile = options.envFile
    ? resolve(workspaceRoot, options.envFile)
    : resolve(workspaceRoot, '.env.local');
  let fileValues: Environment = {};
  if (existsSync(envFile)) {
    try {
      fileValues = parseEnv(readFileSync(envFile, 'utf8'));
    } catch {
      throw new ConfigError([
        { variable: 'ENV_FILE', instruction: 'Provide a readable, valid environment file.' },
      ]);
    }
  } else if (options.envFile) {
    throw new ConfigError([
      { variable: 'ENV_FILE', instruction: 'Provide an existing environment file.' },
    ]);
  }
  const explicit = Object.fromEntries(
    Object.entries(options.env ?? process.env).filter(([, entry]) => entry !== undefined),
  );
  return { env: { ...fileValues, ...explicit }, workspaceRoot };
}

export function loadConfig(options: LoadConfigOptions = {}): ApiConfig {
  const { env, workspaceRoot } = loadEnvironment(options);
  return parseConfig(env, { workspaceRoot });
}
