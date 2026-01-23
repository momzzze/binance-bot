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
import { insertOrder, type OrderRow } from '../../modules/db/queries/orders.js';
import { closePosition } from '../../modules/db/queries/positions.js';
import { getRecentDecisions } from '../../modules/db/queries/decisions.js';
import { query } from '../../modules/db/db.js';
import {
  getActiveCooldowns,
  removeCooldown,
  clearAllCooldowns,
  getCooldownInfo,
} from '../../modules/risk/symbolCooldown.js';
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
 * GET /bot/account - Get account information and balances
 */
router.get('/account', async (req, res) => {
  const { binanceClient } = req.app.locals;

  if (!binanceClient) {
    return res.status(503).json({ error: 'Binance client not configured' });
  }

  try {
    const [accountInfo, openPositions] = await Promise.all([
      binanceClient.getAccountInfo(),
      getOpenPositions(),
    ]);

    // Get assets from open positions with their PnL
    const activeAssets = new Map<string, { pnl: number; positions: number }>();
    for (const pos of openPositions) {
      // Extract base asset from symbol (e.g., BTCUSDT -> BTC)
      const baseAsset = pos.symbol.replace(/USDT$|USDC$|BUSD$/i, '');
      const existing = activeAssets.get(baseAsset) || { pnl: 0, positions: 0 };
      activeAssets.set(baseAsset, {
        pnl: existing.pnl + pos.pnl_usdt,
        positions: existing.positions + 1,
      });
    }

    // Key assets to always include
    const keyAssets = ['USDT', 'USDC', 'BTC', 'ETH', 'BNB'];
    const keyAssetsSet = new Set(keyAssets);

    // Format all balances and filter appropriately
    const balances = accountInfo.balances
      .map((b) => {
        const activeInfo = activeAssets.get(b.asset);
        return {
          asset: b.asset,
          free: parseFloat(b.free),
          locked: parseFloat(b.locked),
          total: parseFloat(b.free) + parseFloat(b.locked),
          isTrading: !!activeInfo,
          activePositions: activeInfo?.positions || 0,
          unrealizedPnl: activeInfo?.pnl || 0,
          isKeyAsset: keyAssetsSet.has(b.asset),
        };
      })
      .filter((b) => b.total > 0 || b.isKeyAsset || b.isTrading)
      .sort((a, b) => {
        // Sort priority: 1) trading assets, 2) key assets, 3) by total value
        if (a.isTrading && !b.isTrading) return -1;
        if (!a.isTrading && b.isTrading) return 1;
        if (a.isKeyAsset && !b.isKeyAsset) return -1;
        if (!a.isKeyAsset && b.isKeyAsset) return 1;
        return b.total - a.total;
      });

    res.json({
      balances,
      canTrade: accountInfo.canTrade,
      canWithdraw: accountInfo.canWithdraw,
      canDeposit: accountInfo.canDeposit,
      updateTime: accountInfo.updateTime,
    });
  } catch (error) {
    log.error('Failed to fetch account info:', error);
    res.status(500).json({ error: 'Failed to fetch account information' });
  }
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
 * GET /bot/positions/notional - Aggregate open position notionals
 */
router.get('/positions/notional', async (req, res) => {
  try {
    const positions = await getOpenPositions();
    const bySymbol = positions.map((p) => ({
      symbol: p.symbol,
      notional: p.current_price * p.quantity,
      quantity: p.quantity,
      current_price: p.current_price,
    }));
    const totalNotional = bySymbol.reduce((acc, p) => acc + p.notional, 0);
    res.json({ totalNotional, positions: bySymbol });
  } catch (error) {
    log.error('Failed to aggregate position notional:', error);
    res.status(500).json({ error: 'Failed to aggregate position notional' });
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
        trade_date::text,
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

    const history = result.rows.map((row: any) => ({
      ...row,
      total_pnl_usdc: parseFloat(row.total_pnl_usdt),
      total_commission_usdc: parseFloat(row.total_commission_usdt),
      net_pnl_usdc: parseFloat(row.net_pnl_usdt),
      best_trade_usdc: parseFloat(row.best_trade_usdt),
      worst_trade_usdc: parseFloat(row.worst_trade_usdt),
    }));

    res.json({ history });
  } catch (error) {
    log.error('Failed to fetch stats history:', error);
    res.status(500).json({ error: 'Failed to fetch stats history' });
  }
});

/**
 * POST /bot/stats/backfill - Backfill daily stats from historical positions
 */
router.post('/stats/backfill', async (req, res) => {
  try {
    const { query: dbQuery } = await import('../../modules/db/db.js');

    // Get all unique dates where positions were closed
    const datesResult = await dbQuery(`
        SELECT DISTINCT (closed_at AT TIME ZONE 'UTC')::date as trade_date
        FROM positions
        WHERE closed_at IS NOT NULL
          AND status IN ('CLOSED', 'STOPPED_OUT', 'TAKE_PROFIT')
        ORDER BY trade_date;
      `);

    const dates = datesResult.rows;
    let processed = 0;

    for (const row of dates) {
      const tradeDate = row.trade_date;

      // Calculate stats for this date
      const statsResult = await dbQuery(
        `
          SELECT
            COUNT(*)::int as total_trades,
            SUM(CASE WHEN pnl_usdt > 0 THEN 1 ELSE 0 END)::int as winning_trades,
            SUM(CASE WHEN pnl_usdt <= 0 THEN 1 ELSE 0 END)::int as losing_trades,
            COALESCE(AVG(pnl_percent), 0) as avg_pnl_percent,
            COALESCE(SUM(pnl_usdt), 0) as total_pnl_usdt,
            0::numeric as total_commission_usdt,
            COALESCE(MAX(pnl_usdt), 0) as best_trade_usdt,
            COALESCE(MIN(pnl_usdt), 0) as worst_trade_usdt
          FROM positions
          WHERE (closed_at AT TIME ZONE 'UTC')::date = $1
            AND status IN ('CLOSED', 'STOPPED_OUT', 'TAKE_PROFIT');
        `,
        [tradeDate]
      );

      const stats = statsResult.rows[0];

      if (!stats || stats.total_trades === 0) {
        continue;
      }

      const winRate =
        stats.total_trades > 0 ? (stats.winning_trades / stats.total_trades) * 100 : 0;
      const netPnl = stats.total_pnl_usdt;

      // Insert into daily_stats
      await dbQuery(
        `
          INSERT INTO daily_stats (
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
            updated_at = NOW();
        `,
        [
          tradeDate,
          stats.total_trades,
          stats.winning_trades,
          stats.losing_trades,
          winRate,
          stats.total_pnl_usdt,
          stats.total_commission_usdt,
          netPnl,
          stats.avg_pnl_percent,
          stats.best_trade_usdt,
          stats.worst_trade_usdt,
        ]
      );

      processed++;
    }

    log.info(`Daily stats backfill complete: ${processed} dates processed`);
    res.json({
      message: 'Daily stats backfilled successfully',
      datesProcessed: processed,
    });
  } catch (error) {
    log.error('Failed to backfill stats:', error);
    res.status(500).json({ error: 'Failed to backfill stats' });
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
    const errorMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: errorMsg });
  }
});

/**
 * GET /bot/cooldowns - Get all symbols currently on cooldown
 */
router.get('/cooldowns', (req, res) => {
  try {
    const cooldowns = getActiveCooldowns();
    res.json({
      cooldowns: cooldowns.map((c) => ({
        symbol: c.symbol,
        reason: c.reason,
        closedAt: new Date(c.closedAt).toISOString(),
        lossPercent: c.lossPercent,
      })),
      count: cooldowns.length,
    });
  } catch (error) {
    log.error('Failed to get cooldowns:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: errorMsg });
  }
});

/**
 * GET /bot/cooldowns/:symbol - Get cooldown info for a specific symbol
 */
router.get('/cooldowns/:symbol', (req, res) => {
  try {
    const { symbol } = req.params;
    const info = getCooldownInfo(symbol.toUpperCase());

    if (!info) {
      return res.json({ onCooldown: false });
    }

    res.json({
      onCooldown: true,
      ...info,
      closedAt: new Date(info.closedAt).toISOString(),
    });
  } catch (error) {
    log.error('Failed to get cooldown info:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: errorMsg });
  }
});

/**
 * DELETE /bot/cooldowns/:symbol - Remove a symbol from cooldown (admin override)
 */
router.delete('/cooldowns/:symbol', (req, res) => {
  try {
    const { symbol } = req.params;
    const removed = removeCooldown(symbol.toUpperCase());

    if (removed) {
      log.info(`🔓 ${symbol} removed from cooldown via API`);
      res.json({ message: `${symbol} removed from cooldown`, success: true });
    } else {
      res.status(404).json({ message: `${symbol} was not on cooldown`, success: false });
    }
  } catch (error) {
    log.error('Failed to remove cooldown:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: errorMsg });
  }
});

/**
 * DELETE /bot/cooldowns - Clear all cooldowns (use with caution)
 */
router.delete('/cooldowns', (req, res) => {
  try {
    clearAllCooldowns();
    log.warn('⚠️ All cooldowns cleared via API');
    res.json({ message: 'All cooldowns cleared', success: true });
  } catch (error) {
    log.error('Failed to clear cooldowns:', error);
    res.status(500).json({ error: 'Failed to update stop loss' });
  }
});

/**
 * GET /bot/test - Simple test endpoint to verify routing works
 */
router.get('/test', (req, res) => {
  res.json({ message: 'Bot routes are working!', timestamp: new Date().toISOString() });
});

/**
 * GET /bot/review/:symbol - Review why a symbol was bought (decisions and orders)
 */
router.get('/review/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const upperSymbol = symbol.toUpperCase();

    // Get recent decisions
    const decisions = await getRecentDecisions(upperSymbol, 10);

    // Get recent buy orders for this symbol
    const ordersResult = await query<OrderRow>(
      `SELECT * FROM orders 
       WHERE symbol = $1 AND side = 'BUY' 
       ORDER BY created_at DESC 
       LIMIT 10`,
      [upperSymbol]
    );
    const orders = ordersResult.rows;

    // Get open position if any
    const positionsResult = await query(
      `SELECT * FROM positions 
       WHERE symbol = $1 AND status = 'OPEN' 
       LIMIT 1`,
      [upperSymbol]
    );
    const position = positionsResult.rows[0] || null;

    res.json({
      symbol: upperSymbol,
      recentDecisions: decisions.map((d) => ({
        timestamp: d.created_at,
        signal: d.signal,
        score: d.score,
        meta: d.meta,
        reason: d.meta?.reason || 'No reason',
      })),
      recentOrders: orders.map((o) => ({
        orderId: o.binance_order_id,
        qty: o.qty,
        timestamp: o.created_at,
        requestJson: o.request_json,
      })),
      openPosition: position
        ? {
            entryPrice: position.entry_price,
            quantity: position.quantity,
            entryTime: position.created_at,
            currentPrice: position.current_price,
            pnl: position.pnl_usdt,
            stopLoss: position.stop_loss_price,
            takeProfit: position.take_profit_price,
          }
        : null,
    });
  } catch (error) {
    log.error('Failed to review symbol:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: errorMsg });
  }
});

export default router;
