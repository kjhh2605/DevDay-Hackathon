import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

export const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));
export function readLocalEnvironment(): NodeJS.ProcessEnv {
  const path = resolve(workspaceRoot, '.env.local');
  return { ...parse(readFileSync(path)), ...process.env };
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Command failed';
}
