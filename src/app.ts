import express from 'express';

import { loadEnv } from './config/env.js';
import { createLogger } from './services/logger.js';
import { initDb, query, closeDb } from './modules/db/db.js';
import { setState } from './modules/db/queries/bot_state.js';
import { redact } from './utils/redact.js';
import { BinanceClient } from './modules/exchange/binanceClient.js';
import { createAppRouter } from './routes/index.js';

const logger = createLogger();
const config = loadEnv();
let binanceClient: BinanceClient | null = null;

async function main() {
  logger.info(
    `Starting Binance Bot (tradingEnabled=${config.TRADING_ENABLED}, killSwitch=${config.BOT_KILL_SWITCH})`
  );
  logger.info(`Symbols: ${config.SYMBOLS.join(', ')}`);
  logger.info(`Connecting to Postgres at ${redact(config.POSTGRES_URL)}`);

  initDb(config.POSTGRES_URL);
  await query('SELECT 1'); // quick connectivity check

  // Initialize bot state from config
  await setState('TRADING_ENABLED', config.TRADING_ENABLED ? 'true' : 'false');
  await setState('BOT_KILL_SWITCH', config.BOT_KILL_SWITCH ? 'true' : 'false');
  logger.info('Bot state initialized from config');

  // Initialize Binance client
  if (config.BINANCE_API_KEY && config.BINANCE_API_SECRET) {
    binanceClient = new BinanceClient({
      baseURL: config.BINANCE_BASE_URL,
      apiKey: config.BINANCE_API_KEY,
      apiSecret: config.BINANCE_API_SECRET,
    });
    await binanceClient.syncServerTime();
    logger.info('Binance client initialized and synced');
  } else {
    logger.warn('Binance API keys not configured, client disabled');
  }

  // Create Express app
  const app = express();
  app.use(express.json());

  // Mount routes
  const appRouter = createAppRouter(binanceClient, config);
  app.use('/', appRouter);

  // Error handler
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('Request error', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  const server = app.listen(config.PORT, () => {
    logger.info(`HTTP server listening on port ${config.PORT}`);
  });

  const shutdown = async () => {
    logger.info('Shutting down...');
    server.close();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error('Fatal error starting bot', err);
  process.exit(1);
});
