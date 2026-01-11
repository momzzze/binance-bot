import { initDb, query, closeDb } from './src/modules/db/db.js';
import { loadEnv } from './src/config/env.js';
import { createLogger } from './src/services/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const log = createLogger('migrate');
const config = loadEnv();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runMigrations() {
  log.info('Starting database migrations...');

  initDb(config.POSTGRES_URL);

  // Create schema_migrations table if it doesn't exist
  await query(`DROP TABLE IF EXISTS schema_migrations CASCADE;`);
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      version TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  log.info('Schema migrations table ready');

  // Find all migration files
  const migrationsDir = path.join(__dirname, 'src', 'modules', 'db', 'migrations');
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  log.info(`Found ${migrationFiles.length} migration files`);

  // Apply each migration
  for (const file of migrationFiles) {
    const version = file.replace('.sql', '');

    // Check if already applied
    const result = await query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);

    if (result.rows.length > 0) {
      log.info(`✓ ${file} already applied`);
      continue;
    }

    // Read and execute migration
    const migrationPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    try {
      await query(sql);
      await query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      log.info(`✓ ${file} applied successfully`);
    } catch (error) {
      log.error(`✗ ${file} failed:`, error);
      throw error;
    }
  }

  log.info('All migrations completed!');
  await closeDb();
}

runMigrations().catch((err) => {
  log.error('Migration failed:', err);
  process.exit(1);
});
