import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { createDatabase, type Database } from './client.js';
export async function migrate(db: Database) {
  const sql = await readFile(new URL('./migrations/0001_initial.sql', import.meta.url), 'utf8');
  await db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(17834031)');
    await tx.query(
      'CREATE TABLE IF NOT EXISTS app_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const existing = await tx.query(
      "SELECT version FROM app_migrations WHERE version='0001_initial'",
    );
    if (!existing.rowCount) {
      await tx.query(sql);
      await tx.query("INSERT INTO app_migrations(version) VALUES ('0001_initial')");
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
