import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync } from 'node:fs';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { readLocalEnvironment, workspaceRoot } from './environment.js';

const host = process.argv.find((a) => a.startsWith('--host='))?.slice(7);
if (!host || !/^[a-zA-Z0-9.:-]+$/.test(host))
  throw new Error('Supply --host=<current-LAN-IP-or-hostname>.');
if (spawnSync('mkcert', ['-version'], { stdio: 'ignore' }).status !== 0) {
  throw new Error(
    'Install mkcert, then run mkcert -install on the development host before creating a LAN certificate. See docs/implementation/local-validation.md.',
  );
}
const directory = resolve(workspaceRoot, '.local/certs');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const certPath = resolve(directory, 'lan.pem');
const keyPath = resolve(directory, 'lan-key.pem');
const result = spawnSync(
  'mkcert',
  ['-cert-file', certPath, '-key-file', keyPath, host, 'localhost', '127.0.0.1', '::1'],
  { stdio: 'inherit' },
);
if (result.status !== 0) process.exit(result.status ?? 1);
chmodSync(keyPath, 0o600);
const port = readLocalEnvironment().WEB_PORT ?? '5173';
const originHost = isIP(host) === 6 ? `[${host}]` : host;
console.log(
  `Set LOCAL_WEB_ORIGIN=https://${originHost}:${port}, SESSION_COOKIE_SECURE=true, LOCAL_TLS_CERT=${certPath}, LOCAL_TLS_KEY=${keyPath}.`,
);
console.log(
  'On the second laptop trust only the public rootCA.pem from mkcert -CAROOT. Never transfer rootCA-key.pem or the server private key.',
);
console.log(
  'Existing .env.local was preserved. After configuring it, run pnpm preflight --target=lan.',
);
