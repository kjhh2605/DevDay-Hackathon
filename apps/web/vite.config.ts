import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { seedDesignPlugin } from '@seed-design/vite-plugin';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../..', import.meta.url));
export default defineConfig(({ mode }) => {
  // Read server settings solely for the dev proxy; no environment object is exposed to client code.
  const env = loadEnv(mode, root, '');
  const port = Number(env.WEB_PORT || 5173);
  const origin = env.LOCAL_WEB_ORIGIN ? new URL(env.LOCAL_WEB_ORIGIN) : null;
  if (origin && Number(origin.port || (origin.protocol === 'https:' ? 443 : 80)) !== port) {
    throw new Error('LOCAL_WEB_ORIGIN의 포트와 WEB_PORT를 맞춰 주세요.');
  }
  const lan = mode === 'lan';
  const needsTls = lan || origin?.protocol === 'https:';
  if (needsTls && (!env.LOCAL_TLS_CERT || !env.LOCAL_TLS_KEY)) {
    throw new Error(
      'HTTPS에는 LOCAL_TLS_CERT와 LOCAL_TLS_KEY가 필요합니다. setup:local의 인증서 안내를 확인하세요.',
    );
  }
  const https = needsTls
    ? {
        cert: readFileSync(resolve(root, env.LOCAL_TLS_CERT)),
        key: readFileSync(resolve(root, env.LOCAL_TLS_KEY)),
      }
    : undefined;
  const proxy = {
    '/api': { target: `http://127.0.0.1:${env.PORT || 3000}`, changeOrigin: false },
    '/ws': { target: `http://127.0.0.1:${env.PORT || 3000}`, changeOrigin: false, ws: true },
  };
  // Match the configured origin: localhost must not select an unrelated IPv6
  // listener while Vite silently takes the same port on IPv4.
  const network = {
    port,
    strictPort: true,
    host: lan ? '0.0.0.0' : (origin?.hostname ?? 'localhost'),
    https,
    proxy,
  };
  return {
    plugins: [react(), seedDesignPlugin({ colorMode: 'light-only' })],
    resolve: { alias: { 'seed-design': fileURLToPath(new URL('./seed-design', import.meta.url)) } },
    envDir: root,
    server: network,
    preview: network,
  };
});
