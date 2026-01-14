import { query } from '../db.js';

export interface DailyStatsRow {
  id: number;
  trade_date: Date;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_pnl_usdt: number;
  total_commission_usdt: number;
  net_pnl_usdt: number;
  avg_pnl_percent: number;
  best_trade_usdt: number;
  worst_trade_usdt: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * Update daily stats after closing a position
 * Recalculates all stats for the given date based on closed positions
 */
export async function updateDailyStats(tradeDate: Date = new Date()): Promise<void> {
  const dateStr = tradeDate.toISOString().split('T')[0]; // YYYY-MM-DD

  // Calculate stats from closed positions for this date
  const statsQuery = `
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
  `;

  const statsResult = await query(statsQuery, [dateStr]);
  const stats = statsResult.rows[0];

  if (!stats || stats.total_trades === 0) {
    // No trades for this date, skip
    return;
  }

  const winRate = stats.total_trades > 0 ? (stats.winning_trades / stats.total_trades) * 100 : 0;
  const netPnl = stats.total_pnl_usdt;

  // Upsert into daily_stats
  const upsertQuery = `
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
      worst_trade_usdt,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
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
  `;

  await query(upsertQuery, [
    dateStr,
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
  ]);
}

/**
 * Get daily stats history
 */
export async function getDailyStatsHistory(days: number = 30): Promise<DailyStatsRow[]> {
  const sql = `
    SELECT *
    FROM daily_stats
    ORDER BY trade_date DESC
    LIMIT $1;
  `;
  const result = await query<DailyStatsRow>(sql, [days]);
  return result.rows;
}
