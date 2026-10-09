import { readFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { ApiConfig } from '../config.js';
import * as schema from './schema.js';
export type SqlClient = Pick<PoolClient, 'query'>;
export async function createDatabase(config: ApiConfig) {
  const c = config.database;
  const pool = new Pool({
    host: c.host,
    port: c.port,
    database: c.name,
    user: c.user,
    password: c.password,
    ssl:
      c.sslMode === 'verify-full'
        ? { ca: await readFile(c.sslCaPath!, 'utf8'), rejectUnauthorized: true, servername: c.host }
        : false,
    max: 10,
  });
  return new Database(pool);
}
export class Database {
  readonly orm;
  constructor(readonly pool: Pool) {
    this.orm = drizzle(pool, { schema });
  }
  async transaction<T>(fn: (tx: SqlClient) => Promise<T>, repeatableRead = false): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(repeatableRead ? 'BEGIN ISOLATION LEVEL REPEATABLE READ' : 'BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async ready(): Promise<boolean> {
    try {
      const r = await this.pool.query(
        "SELECT version FROM app_migrations WHERE version='0001_initial'",
      );
      return r.rowCount === 1;
    } catch {
      return false;
    }
  }
  async close() {
    await this.pool.end();
  }
}
export async function one<T>(
  tx: SqlClient,
  query: string,
  params: unknown[] = [],
): Promise<T | null> {
  const r = await tx.query(query, params);
  return (r.rows[0]?.data as T | undefined) ?? null;
}
export async function many<T>(tx: SqlClient, query: string, params: unknown[] = []): Promise<T[]> {
  const r = await tx.query(query, params);
  return r.rows.map((row) => row.data as T);
}
export async function update(tx: SqlClient, table: string, id: string, data: unknown) {
  await tx.query(`UPDATE ${table} SET data=$2 WHERE id=$1`, [id, JSON.stringify(data)]);
}
