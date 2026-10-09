import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from '../../apps/api/src/app.js';
import { loadEnvironment, parseConfig } from '../../apps/api/src/config.js';

const { env, workspaceRoot } = loadEnvironment();
const session = JSON.parse(
  await readFile(resolve(workspaceRoot, '.local/validation/live-inspection-session.json'), 'utf8'),
) as { databaseName: string; mediaDirectory: string };
if (!/^devday_live_\d+$/.test(session.databaseName))
  throw new Error('Inspection requires a dedicated live-validation database.');
const port = Number(process.env.LIVE_INSPECT_API_PORT ?? 4202);
const webPort = Number(process.env.LIVE_INSPECT_WEB_PORT ?? 5180);
const config = parseConfig(
  {
    ...env,
    AI_MODE: 'live',
    APP_ENV: 'local',
    NODE_ENV: 'test',
    DB_NAME: session.databaseName,
    API_HOST: '127.0.0.1',
    PORT: String(port),
    WEB_PORT: String(webPort),
    LOCAL_WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
    LOCAL_TLS_CERT: '',
    LOCAL_TLS_KEY: '',
    SESSION_COOKIE_SECURE: 'false',
    MEDIA_DRIVER: 'filesystem',
    MEDIA_LOCAL_DIR: session.mediaDirectory,
  },
  { workspaceRoot },
);
const { app } = await createApp({ config, logger: false, interruptJobs: false });
await app.listen({ host: config.host, port: config.port });
console.info(
  `Existing live-validation API: http://127.0.0.1:${port}; browser origin http://127.0.0.1:${webPort}. No provider calls occur until a product action requests one.`,
);
let closing = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    void app.close().then(() => process.exit(0));
  });
