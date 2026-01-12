import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

import { loadEnv } from '../../config/env.js';
import { createLogger } from '../../services/logger.js';
import { initDb, closeDb, query } from './db.js';

const logger = createLogger();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

async function ensureDatabaseExists(connectionString: string) {
  const url = new URL(connectionString);
  const dbName = url.pathname.replace(/^\//, '') || 'postgres';
  const adminUrl = new URL(connectionString);
  adminUrl.pathname = '/postgres';

  const adminPool = new Pool({ connectionString: adminUrl.toString() });
  try {
    const exists = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (exists.rowCount === 0) {
      logger.info(`Database ${dbName} not found, creating...`);
      await adminPool.query(`CREATE DATABASE ${quoteIdent(dbName)}`);
      logger.info(`Created database ${dbName}`);
    }
  } finally {
    await adminPool.end();
  }
}

async function ensureMigrationsTable() {
  await query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`
  );
}

async function getApplied(): Promise<Set<string>> {
  const res = await query<{ filename: string }>('SELECT filename FROM schema_migrations');
  return new Set(res.rows.map((r) => r.filename));
}

async function recordApplied(filename: string) {
  await query('INSERT INTO schema_migrations(filename) VALUES ($1) ON CONFLICT DO NOTHING', [
    filename,
  ]);
}

async function runMigrations() {
  const config = loadEnv();
  logger.info(`Running migrations on ${config.POSTGRES_URL}`);
  await ensureDatabaseExists(config.POSTGRES_URL);
  initDb(config.POSTGRES_URL);

  await ensureMigrationsTable();
  const applied = await getApplied();

  const migrationsDir = path.resolve(__dirname, 'migrations');
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) {
      logger.info(`Skipping already applied migration ${file}`);
      continue;
    }

    const fullPath = path.join(migrationsDir, file);
    const sql = await readFile(fullPath, 'utf8');
    logger.info(`Applying migration ${file}`);
    await query(sql);
    await recordApplied(file);
    logger.info(`Applied ${file}`);
  }

  logger.info('Migrations complete');
  await closeDb();
}

runMigrations().catch(async (err) => {
  logger.error('Migration failed', err);
  await closeDb();
  process.exit(1);
});
