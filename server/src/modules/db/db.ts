import { Pool, QueryResult } from 'pg';

let pool: Pool | null = null;

export function initDb(connectionString: string): Pool {
  pool = new Pool({ connectionString });
  return pool;
}

export function getDb(): Pool {
  if (!pool) throw new Error('Database not initialized. Call initDb() first.');
  return pool;
}

export async function query<T>(text: string, params: any[] = []): Promise<QueryResult<T>> {
  if (!pool) throw new Error('Database not initialized. Call initDb() first.');
  return pool.query<T>(text, params);
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
