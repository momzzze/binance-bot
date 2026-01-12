import { initDb, query, closeDb } from './db.js';
import { loadEnv } from '../../config/env.js';
import { createLogger } from '../../services/logger.js';

const log = createLogger('quickfix');

async function quickFix() {
  const config = loadEnv();
  log.info('Creating tables directly...');

  initDb(config.POSTGRES_URL);

  try {
    // Create candles table
    await query(`
      CREATE TABLE IF NOT EXISTS candles (
        id SERIAL PRIMARY KEY,
        symbol TEXT NOT NULL,
        interval TEXT NOT NULL,
        open_time BIGINT NOT NULL,
        open NUMERIC NOT NULL,
        high NUMERIC NOT NULL,
        low NUMERIC NOT NULL,
        close NUMERIC NOT NULL,
        volume NUMERIC NOT NULL,
        close_time BIGINT NOT NULL,
        quote_asset_volume NUMERIC,
        number_of_trades INTEGER,
        taker_buy_base_asset_volume NUMERIC,
        taker_buy_quote_asset_volume NUMERIC,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(symbol, interval, open_time)
      );
    `);
    log.info('✓ Created candles table');

    await query(`
      CREATE INDEX IF NOT EXISTS idx_candles_symbol_interval_time 
        ON candles(symbol, interval, open_time DESC);
    `);
    log.info('✓ Created candles indexes');

    // Create strategy_config table
    await query(`
      CREATE TABLE IF NOT EXISTS strategy_config (
        id SERIAL PRIMARY KEY,
        strategy_name TEXT NOT NULL UNIQUE,
        is_active BOOLEAN DEFAULT false,
        sma_short_period INTEGER DEFAULT 20,
        sma_long_period INTEGER DEFAULT 50,
        ema_short_period INTEGER DEFAULT 12,
        ema_long_period INTEGER DEFAULT 26,
        rsi_period INTEGER DEFAULT 14,
        rsi_overbought INTEGER DEFAULT 70,
        rsi_oversold INTEGER DEFAULT 30,
        buy_score_threshold INTEGER DEFAULT 5,
        sell_score_threshold INTEGER DEFAULT -5,
        stop_loss_percent NUMERIC DEFAULT 4.0,
        take_profit_percent NUMERIC DEFAULT 5.0,
        trailing_stop_enabled BOOLEAN DEFAULT true,
        trailing_stop_activation_percent NUMERIC DEFAULT 2.0,
        trailing_stop_distance_percent NUMERIC DEFAULT 2.0,
        risk_per_trade_percent NUMERIC DEFAULT 2.0,
        min_volume_usdt NUMERIC DEFAULT 1000000,
        require_volume_spike BOOLEAN DEFAULT false,
        volume_spike_multiplier NUMERIC DEFAULT 1.5,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    log.info('✓ Created strategy_config table');

    await query(`
      INSERT INTO strategy_config (
        strategy_name, 
        is_active, 
        description,
        stop_loss_percent,
        take_profit_percent,
        trailing_stop_activation_percent,
        trailing_stop_distance_percent,
        risk_per_trade_percent
      ) VALUES (
        'sma-crossover',
        true,
        'SMA crossover with EMA momentum and RSI filters',
        4.0,
        5.0,
        2.0,
        2.0,
        2.0
      ) ON CONFLICT (strategy_name) DO NOTHING
    `);
    log.info('✓ Inserted default strategy config');

    log.info('✅ All tables created successfully!');
  } catch (error) {
    log.error('Failed:', error);
  } finally {
    await closeDb();
  }
}

async function clearCandles() {
  const config = loadEnv();
  initDb(config.POSTGRES_URL);

  try {
    await query('TRUNCATE TABLE candles CASCADE;');
    log.info('✅ Cleared all candles from database!');
  } catch (error) {
    log.error('Failed to clear candles:', error);
  } finally {
    await closeDb();
  }
}

const args = process.argv.slice(2);
if (args.includes('--clear-candles')) {
  clearCandles();
} else {
  quickFix();
}
