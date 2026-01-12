import { loadEnv } from '../../config/env.js';
import { createLogger } from '../../services/logger.js';
import { initDb, closeDb, query } from './db.js';

const log = createLogger('fix-migrations');

async function fixMigrations() {
  const config = loadEnv();
  initDb(config.POSTGRES_URL);

  try {
    log.info('Dropping old schema_migrations table...');
    await query('DROP TABLE IF EXISTS schema_migrations CASCADE;');

    log.info('Creating new schema_migrations table...');
    await query(`
      CREATE TABLE schema_migrations (
        id SERIAL PRIMARY KEY,
        filename TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    log.info('✅ Fixed schema_migrations table!');
  } catch (error) {
    log.error('Failed to fix migrations table:', error);
  } finally {
    await closeDb();
  }
}

fixMigrations();
