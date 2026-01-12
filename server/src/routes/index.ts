import { Router } from 'express';
import healthRouter from './v1/health.js';
import botRouter from './v1/bot.js';
import tradesRouter from './v1/trades.js';
import strategyRouter from './v1/strategy.js';
import candlesRouter from './v1/candles.js';

const router = Router();

router.use('/health', healthRouter);
router.use('/bot', botRouter);
router.use('/trades', tradesRouter);
router.use('/strategy', strategyRouter);
router.use('/candles', candlesRouter);

export default router;
