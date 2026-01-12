import { Router } from 'express';
import {
  runBot,
  stopBot,
  isBotRunning,
  getCurrentSymbols,
  getSymbolSource,
} from '../../modules/runner/botRunner.js';
import {
  getOpenPositions,
  getClosedPositions,
  getPositionById,
  updatePositionStopLoss,
} from '../../modules/db/queries/positions.js';
import { insertOrder } from '../../modules/db/queries/orders.js';
import { closePosition } from '../../modules/db/queries/positions.js';
import { createLogger } from '../../services/logger.js';

const log = createLogger('routes/bot');
const router = Router();

/**
 * GET /bot/status - Get bot running status
 */
router.get('/status', (req, res) => {
  const { config } = req.app.locals;

  res.json({
    running: isBotRunning(),
    symbols: getCurrentSymbols().length > 0 ? getCurrentSymbols() : config.SYMBOLS,
    symbolSource: getSymbolSource(),
    loopMs: config.LOOP_MS,
    tradingEnabled: config.TRADING_ENABLED,
    killSwitch: config.BOT_KILL_SWITCH,
  });
});

/**
 * GET /bot/positions - Get all open positions
 */
router.get('/positions', async (req, res) => {
  try {
    const positions = await getOpenPositions();
    res.json({ positions });
  } catch (error) {
    log.error('Failed to fetch positions:', error);
    res.status(500).json({ error: 'Failed to fetch positions' });
  }
});

/**
 * GET /bot/positions/closed - Get closed positions
 */
router.get('/positions/closed', async (req, res) => {
  try {
    const symbol = req.query.symbol as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 1000);
    const offset = parseInt(req.query.offset as string) || 0;

    const positions = await getClosedPositions(symbol, limit, offset);
    res.json({ positions });
  } catch (error) {
    log.error('Failed to fetch closed positions:', error);
    res.status(500).json({ error: 'Failed to fetch closed positions' });
  }
});

/**
 * GET /bot/stats/daily - Get daily PnL statistics
 */
router.get('/stats/daily', async (req, res) => {
  try {
    const { query: dbQuery } = await import('../../modules/db/db.js');

    // Get today's closed positions
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = await dbQuery(
      `
      SELECT 
        COUNT(*) as total_trades,
        SUM(CASE WHEN pnl_usdt > 0 THEN 1 ELSE 0 END) as winning_trades,
        SUM(CASE WHEN pnl_usdt < 0 THEN 1 ELSE 0 END) as losing_trades,
        SUM(pnl_usdt) as total_pnl_usdt,
        AVG(pnl_percent) as avg_pnl_percent,
        MAX(pnl_usdt) as best_trade_usdt,
        MIN(pnl_usdt) as worst_trade_usdt
      FROM positions
      WHERE status IN ('CLOSED', 'STOPPED_OUT', 'TAKE_PROFIT')
        AND closed_at >= $1
    `,
      [today.toISOString()]
    );

    const stats = result.rows[0];

    res.json({
      today: {
        total_trades: parseInt(stats.total_trades) || 0,
        winning_trades: parseInt(stats.winning_trades) || 0,
        losing_trades: parseInt(stats.losing_trades) || 0,
        win_rate:
          stats.total_trades > 0
            ? ((parseInt(stats.winning_trades) / parseInt(stats.total_trades)) * 100).toFixed(2)
            : '0.00',
        total_pnl_usdt: parseFloat(stats.total_pnl_usdt) || 0,
        avg_pnl_percent: parseFloat(stats.avg_pnl_percent) || 0,
        best_trade_usdt: parseFloat(stats.best_trade_usdt) || 0,
        worst_trade_usdt: parseFloat(stats.worst_trade_usdt) || 0,
      },
    });
  } catch (error) {
    log.error('Failed to fetch daily stats:', error);
    res.status(500).json({ error: 'Failed to fetch daily stats' });
  }
});

/**
 * POST /bot/stats/daily/save - Save current day's stats to history
 */
router.post('/stats/daily/save', async (req, res) => {
  try {
    const { query: dbQuery } = await import('../../modules/db/db.js');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = await dbQuery(
      `
      SELECT 
        COUNT(*) as total_trades,
        SUM(CASE WHEN pnl_usdt > 0 THEN 1 ELSE 0 END) as winning_trades,
        SUM(CASE WHEN pnl_usdt < 0 THEN 1 ELSE 0 END) as losing_trades,
        SUM(pnl_usdt) as total_pnl_usdt,
        SUM(COALESCE(entry_commission, 0) + COALESCE(exit_commission, 0)) as total_commission_usdt,
        AVG(pnl_percent) as avg_pnl_percent,
        MAX(pnl_usdt) as best_trade_usdt,
        MIN(pnl_usdt) as worst_trade_usdt
      FROM positions
      WHERE status IN ('CLOSED', 'STOPPED_OUT', 'TAKE_PROFIT')
        AND closed_at >= $1
        AND closed_at < $2
    `,
      [today.toISOString(), new Date(today.getTime() + 86400000).toISOString()]
    );

    const stats = result.rows[0];
    const totalTrades = parseInt(stats.total_trades) || 0;
    const winningTrades = parseInt(stats.winning_trades) || 0;
    const totalPnl = parseFloat(stats.total_pnl_usdt) || 0;
    const totalCommission = parseFloat(stats.total_commission_usdt) || 0;

    await dbQuery(
      `
      INSERT INTO daily_stats (
        trade_date, total_trades, winning_trades, losing_trades, win_rate,
        total_pnl_usdt, total_commission_usdt, net_pnl_usdt, avg_pnl_percent,
        best_trade_usdt, worst_trade_usdt
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (trade_date) DO UPDATE SET
        total_trades = EXCLUDED.total_trades,
        winning_trades = EXCLUDED.winning_trades,
        losing_trades = EXCLUDED.losing_trades,
        win_rate = EXCLUDED.win_rate,
        total_pnl_usdt = EXCLUDED.total_pnl_usdt,
        total_commission_usdt = EXCLUDED.total_commission_usdt,
        net_pnl_usdt = EXCLUDED.net_pnl_usdt,
        avg_pnl_percent = EXCLUDED.avg_pnl_percent,
        best_trade_usdt = EXCLUDED.best_trade_usdt,
        worst_trade_usdt = EXCLUDED.worst_trade_usdt,
        updated_at = NOW()
    `,
      [
        today.toISOString().split('T')[0],
        totalTrades,
        winningTrades,
        parseInt(stats.losing_trades) || 0,
        totalTrades > 0 ? ((winningTrades / totalTrades) * 100).toFixed(2) : 0,
        totalPnl,
        totalCommission,
        totalPnl - totalCommission,
        parseFloat(stats.avg_pnl_percent) || 0,
        parseFloat(stats.best_trade_usdt) || 0,
        parseFloat(stats.worst_trade_usdt) || 0,
      ]
    );

    log.info(`💾 Saved daily stats for ${today.toISOString().split('T')[0]}`);
    res.json({ message: 'Daily stats saved successfully' });
  } catch (error) {
    log.error('Failed to save daily stats:', error);
    res.status(500).json({ error: 'Failed to save daily stats' });
  }
});

/**
 * GET /bot/stats/history - Get historical daily stats
 */
router.get('/stats/history', async (req, res) => {
  try {
    const { query: dbQuery } = await import('../../modules/db/db.js');
    const days = Math.min(parseInt(req.query.days as string) || 30, 365);

    const result = await dbQuery(
      `
      SELECT 
        trade_date,
        total_trades,
        winning_trades,
        losing_trades,
        win_rate,
        total_pnl_usdt,
        total_commission_usdt,
        net_pnl_usdt,
        avg_pnl_percent,
        best_trade_usdt,
        worst_trade_usdt
      FROM daily_stats
      ORDER BY trade_date DESC
      LIMIT $1
    `,
      [days]
    );

    res.json({ history: result.rows });
  } catch (error) {
    log.error('Failed to fetch stats history:', error);
    res.status(500).json({ error: 'Failed to fetch stats history' });
  }
});

/**
 * POST /bot/start - Start the bot
 */
router.post('/start', async (req, res) => {
  const { binanceClient, config } = req.app.locals;

  if (!binanceClient) {
    return res.status(503).json({ error: 'Binance client not configured' });
  }

  if (isBotRunning()) {
    return res.status(400).json({ error: 'Bot is already running' });
  }

  try {
    // Start bot in background (non-blocking)
    runBot(binanceClient, config).catch((err) => {
      log.error('Bot crashed:', err);
    });

    res.json({ message: 'Bot started successfully', running: true });
  } catch (error) {
    log.error('Failed to start bot:', error);
    res.status(500).json({ error: 'Failed to start bot' });
  }
});

/**
 * POST /bot/stop - Stop the bot
 */
router.post('/stop', (req, res) => {
  if (!isBotRunning()) {
    return res.status(400).json({ error: 'Bot is not running' });
  }

  stopBot();
  res.json({ message: 'Bot stop signal sent', running: false });
});

/**
 * POST /bot/positions/:id/close - Manually close a position
 */
router.post('/positions/:id/close', async (req, res) => {
  const { binanceClient } = req.app.locals;
  const positionId = req.params.id;

  if (!binanceClient) {
    return res.status(503).json({ error: 'Binance client not configured' });
  }

  try {
    const position = await getPositionById(positionId);

    if (!position) {
      return res.status(404).json({ error: 'Position not found' });
    }

    if (position.status !== 'OPEN') {
      return res.status(400).json({ error: 'Position is not open' });
    }

    // Execute market sell order
    const clientOrderId = `bot_manual_exit_${Date.now()}_${position.symbol}`;
    const request = {
      symbol: position.symbol,
      side: 'SELL' as const,
      type: 'MARKET' as const,
      quantity: position.quantity.toFixed(6),
    };

    const response = await binanceClient.createOrder(request);

    // Persist exit order
    await insertOrder({
      symbol: position.symbol,
      side: 'SELL',
      type: 'MARKET',
      qty: position.quantity,
      status: 'NEW',
      binance_order_id: response.orderId.toString(),
      client_order_id: clientOrderId,
      request_json: request,
      response_json: response,
    });

    // Close position
    await closePosition(position.id, response.orderId.toString(), 'CLOSED');

    log.info(
      `✅ Manually closed position ${position.id} for ${position.symbol} | Order ${response.orderId}`
    );
    res.json({ message: 'Position closed successfully', orderId: response.orderId });
  } catch (error) {
    log.error(`Failed to close position ${positionId}:`, error);
    res.status(500).json({ error: 'Failed to close position' });
  }
});

/**
 * PATCH /bot/positions/:id/stop-loss - Update stop loss price for a position
 */
router.patch('/positions/:id/stop-loss', async (req, res) => {
  const positionId = req.params.id;
  const { stop_loss_price } = req.body;

  if (!stop_loss_price || typeof stop_loss_price !== 'number') {
    return res.status(400).json({ error: 'stop_loss_price is required and must be a number' });
  }

  try {
    const position = await getPositionById(positionId);

    if (!position) {
      return res.status(404).json({ error: 'Position not found' });
    }

    if (position.status !== 'OPEN') {
      return res.status(400).json({ error: 'Position is not open' });
    }

    // Update stop loss
    await updatePositionStopLoss(positionId, stop_loss_price);

    log.info(
      `✏️ Manually updated stop loss for ${position.symbol}: ${position.stop_loss_price?.toFixed(4) ?? 'N/A'} → ${stop_loss_price.toFixed(4)}`
    );
    res.json({ message: 'Stop loss updated successfully', stop_loss_price });
  } catch (error) {
    log.error(`Failed to update stop loss for position ${positionId}:`, error);
    res.status(500).json({ error: 'Failed to update stop loss' });
  }
});

export default router;
