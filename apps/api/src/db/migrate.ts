import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { createDatabase, type Database } from './client.js';
export async function migrate(db: Database) {
  const directory = new URL('./migrations/', import.meta.url);
  const files = (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  await db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(17834031)');
    await tx.query(
      'CREATE TABLE IF NOT EXISTS app_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const file of files) {
      const version = file.slice(0, -4);
      if (
        (await tx.query('SELECT version FROM app_migrations WHERE version=$1', [version])).rowCount
      )
        continue;
      await tx.query(await readFile(new URL(file, directory), 'utf8'));
      await tx.query('INSERT INTO app_migrations(version) VALUES ($1)', [version]);
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = await createDatabase(await loadConfig());
  try {
    await migrate(db);
    console.log('Database migrations applied.');
  } finally {
    await db.close();
  }
}
