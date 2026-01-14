/**
 * Backfill daily stats from historical closed positions
 * Run this script to populate the daily_stats table with historical data
 */

import { query } from './db.js';

async function backfillDailyStats() {
  console.log('Starting daily stats backfill...');

  // Get all unique dates where positions were closed
  const datesResult = await query(`
    SELECT DISTINCT DATE(closed_at) as trade_date
    FROM positions
    WHERE closed_at IS NOT NULL
      AND status IN ('CLOSED', 'STOPPED_OUT', 'TAKE_PROFIT')
    ORDER BY trade_date;
  `);

  const dates = datesResult.rows.map((row: any) => row.trade_date);
  console.log(`Found ${dates.length} unique trading dates`);

  for (const tradeDate of dates) {
    // Calculate stats for this date
    const statsResult = await query(
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
      WHERE DATE(closed_at) = $1
        AND status IN ('CLOSED', 'STOPPED_OUT', 'TAKE_PROFIT');
    `,
      [tradeDate]
    );

    const stats = statsResult.rows[0];

    if (!stats || stats.total_trades === 0) {
      continue;
    }

    const winRate = stats.total_trades > 0 ? (stats.winning_trades / stats.total_trades) * 100 : 0;
    const netPnl = stats.total_pnl_usdt;

    // Insert into daily_stats
    await query(
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

    console.log(
      `✓ Backfilled stats for ${tradeDate}: ${stats.total_trades} trades, PnL: ${stats.total_pnl_usdt.toFixed(2)} USDT`
    );
  }

  console.log('\nBackfill complete!');
}

// If running as a script
if (import.meta.url === `file://${process.argv[1]}`) {
  const { initDb, closeDb } = await import('./db.js');
  const config = await import('../../config/env.js');

  try {
    initDb(config.DATABASE_URL);
    await backfillDailyStats();
  } catch (error) {
    console.error('Backfill failed:', error);
    process.exit(1);
  } finally {
    await closeDb();
  }
}

export { backfillDailyStats };
