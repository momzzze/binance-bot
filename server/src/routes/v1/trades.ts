import { Router } from 'express';
import { getOrders, getOrderStats, getOrdersCount } from '../../modules/db/queries/orders.js';
import { getRecentDecisions } from '../../modules/db/queries/decisions.js';
import { createLogger } from '../../services/logger.js';

const log = createLogger('routes/trades');
const router = Router();

/**
 * GET /trades - Get all orders/trades with optional filters
 */
router.get('/', async (req, res) => {
  try {
    const symbol = req.query.symbol as string | undefined;
    const side = req.query.side as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const offset = parseInt(req.query.offset as string) || 0;

    const [trades, total] = await Promise.all([
      getOrders(symbol, side, limit, offset),
      getOrdersCount(symbol, side),
    ]);

    res.json({
      trades,
      total,
      count: trades.length,
      limit,
      offset,
    });
  } catch (error) {
    log.error('Failed to fetch trades:', error);
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
});

/**
 * GET /trades/stats - Get trading statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const symbol = req.query.symbol as string | undefined;
    const stats = await getOrderStats(symbol);

    res.json({
      symbol: symbol || 'ALL',
      ...stats,
    });
  } catch (error) {
    log.error('Failed to fetch stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * GET /trades/signals - Get recent trading signals/decisions
 */
router.get('/signals', async (req, res) => {
  try {
    const symbol = req.query.symbol as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 1000);

    if (!symbol) {
      return res.status(400).json({ error: 'symbol parameter required' });
    }

    const decisions = await getRecentDecisions(symbol, limit);
    res.json({
      symbol,
      signals: decisions,
      count: decisions.length,
    });
  } catch (error) {
    log.error('Failed to fetch signals:', error);
    res.status(500).json({ error: 'Failed to fetch signals' });
  }
});

/**
 * GET /trades/summary - Get trading summary for all symbols
 */
router.get('/summary', async (req, res) => {
  try {
    const stats = await getOrderStats();
    const totalStats = await getOrderStats();

    res.json({
      timestamp: new Date().toISOString(),
      overall: totalStats,
    });
  } catch (error) {
    log.error('Failed to fetch summary:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

export default router;
