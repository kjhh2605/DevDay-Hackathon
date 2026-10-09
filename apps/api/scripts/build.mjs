import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const dependencies = Object.keys(require('../package.json').dependencies).filter(
  (name) => !name.startsWith('@devday/'),
);
await build({
  entryPoints: ['src/server.ts', 'src/db/migrate.ts'],
  outbase: 'src',
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  external: dependencies,
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
await mkdir('dist/db/migrations', { recursive: true });
await cp('src/db/migrations', 'dist/db/migrations', { recursive: true });
