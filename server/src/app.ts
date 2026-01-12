import express from 'express';
import cors from 'cors';

import { loadEnv } from './config/env.js';
import { createLogger } from './services/logger.js';
import { initDb, query, closeDb } from './modules/db/db.js';
import { setState } from './modules/db/queries/bot_state.js';
import { redact } from './utils/redact.js';
import { BinanceClient } from './modules/exchange/binanceClient.js';
import router from './routes/index.js';

const logger = createLogger();
const config = loadEnv();

const app = express();

// CORS - Allow all origins in development
app.use(
  cors({
    origin: '*', // Allow all origins for development
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path} - ${res.statusCode} [${duration}ms]`);
  });
  next();
});

// Mount API routes
app.use('/api', router);

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Request error', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(config.PORT, async () => {
  logger.info(`HTTP server listening on port ${config.PORT}`);
  logger.info(
    `Starting Binance Bot (tradingEnabled=${config.TRADING_ENABLED}, killSwitch=${config.BOT_KILL_SWITCH})`
  );
  logger.info(`Symbols: ${config.SYMBOLS.join(', ')}`);
  logger.info(`Connecting to Postgres at ${redact(config.POSTGRES_URL)}`);

  try {
    // Initialize database
    initDb(config.POSTGRES_URL);
    await query('SELECT 1');

    // Initialize bot state
    await setState('TRADING_ENABLED', config.TRADING_ENABLED ? 'true' : 'false');
    await setState('BOT_KILL_SWITCH', config.BOT_KILL_SWITCH ? 'true' : 'false');
    logger.info('Bot state initialized from config');

    // Initialize Binance client
    let binanceClient: BinanceClient | null = null;
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

    // Store binanceClient and config in app.locals for routes
    app.locals.binanceClient = binanceClient;
    app.locals.config = config;

    // Bot ready - MANUAL START ONLY
    logger.info('✅ Bot ready. Use POST /api/bot/start to start trading');
  } catch (error) {
    logger.error('Failed to initialize:', error);
    process.exit(1);
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await closeDb();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await closeDb();
  process.exit(0);
});
