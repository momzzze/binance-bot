import { Router } from 'express';
import healthRouter from './health.js';
import { createBinanceRouter } from './binance.js';
import { createBotRouter } from './bot.js';
import { createTradesRouter } from './trades.js';
import type { BinanceClient } from '../../modules/exchange/binanceClient.js';
import type { BotConfig } from '../../config/env.js';

export function createV1Router(binanceClient: BinanceClient | null, config: BotConfig) {
  const router = Router();

  // Mount health routes
  router.use('/', healthRouter);

  // Mount binance routes
  const binanceRouter = createBinanceRouter(binanceClient);
  router.use('/binance', binanceRouter);

  // Mount bot control routes
  const botRouter = createBotRouter(binanceClient, config);
  router.use('/bot', botRouter);

  // Mount trades/analytics routes
  const tradesRouter = createTradesRouter();
  router.use('/trades', tradesRouter);

  return router;
}
