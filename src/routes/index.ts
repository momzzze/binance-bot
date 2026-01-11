import { Router } from 'express';
import { createV1Router } from './v1/index.js';
import type { BinanceClient } from '../modules/exchange/binanceClient.js';
import type { BotConfig } from '../config/env.js';

export function createAppRouter(binanceClient: BinanceClient | null, config: BotConfig) {
  const router = Router();

  // Mount v1 API routes
  const v1Router = createV1Router(binanceClient, config);
  router.use('/api', v1Router);

  return router;
}
