import { query } from '../db.js';

export type PositionRow = {
  id: string;
  symbol: string;
  side: string;
  entry_price: number;
  quantity: number;
  current_price: number;
  stop_loss_price?: number | null;
  take_profit_price?: number | null;
  initial_stop_loss_price?: number | null;
  pnl_usdt: number;
  pnl_percent: number;
  status: string;
  entry_order_id?: string | null;
  exit_order_id?: string | null;
  trailing_stop_enabled: boolean;
  highest_price?: number | null;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
};

export async function createPosition(row: Partial<PositionRow>): Promise<PositionRow> {
  const sql = `
    INSERT INTO positions (
      symbol, side, entry_price, quantity, current_price,
      stop_loss_price, take_profit_price, initial_stop_loss_price,
      entry_order_id, trailing_stop_enabled, highest_price, status
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
    ) RETURNING *;
  `;
  const params = [
    row.symbol,
    row.side ?? 'LONG',
    row.entry_price,
    row.quantity,
    row.current_price ?? row.entry_price,
    row.stop_loss_price ?? null,
    row.take_profit_price ?? null,
    row.initial_stop_loss_price ?? row.stop_loss_price ?? null,
    row.entry_order_id ?? null,
    row.trailing_stop_enabled ?? false,
    row.highest_price ?? row.entry_price,
    row.status ?? 'OPEN',
  ];
  const res = await query<PositionRow>(sql, params);
  return res.rows[0];
}

export async function getOpenPositions(symbol?: string): Promise<PositionRow[]> {
  let sql = `SELECT * FROM positions WHERE status = 'OPEN'`;
  const params: unknown[] = [];

  if (symbol) {
    sql += ` AND symbol = $1`;
    params.push(symbol);
  }

  sql += ` ORDER BY created_at DESC`;
  const res = await query<any>(sql, params);

  // Convert numeric strings to numbers
  return res.rows.map((row) => ({
    ...row,
    entry_price: Number(row.entry_price),
    quantity: Number(row.quantity),
    current_price: Number(row.current_price),
    stop_loss_price: row.stop_loss_price ? Number(row.stop_loss_price) : null,
    take_profit_price: row.take_profit_price ? Number(row.take_profit_price) : null,
    initial_stop_loss_price: row.initial_stop_loss_price
      ? Number(row.initial_stop_loss_price)
      : null,
    pnl_usdt: Number(row.pnl_usdt),
    pnl_percent: Number(row.pnl_percent),
    highest_price: row.highest_price ? Number(row.highest_price) : null,
  }));
}

export async function updatePositionPrice(
  id: string,
  currentPrice: number,
  highestPrice?: number
): Promise<PositionRow> {
  const sql = `
    UPDATE positions
    SET
      current_price = $2,
      highest_price = CASE
        WHEN $3::numeric IS NOT NULL THEN GREATEST(COALESCE(highest_price, entry_price), $3::numeric)
        ELSE highest_price
      END,
      pnl_usdt = ($2 - entry_price) * quantity,
      pnl_percent = (($2 - entry_price) / entry_price) * 100,
      updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;
  const res = await query<PositionRow>(sql, [id, currentPrice, highestPrice ?? null]);
  return res.rows[0];
}

export async function updatePositionStopLoss(
  id: string,
  stopLossPrice: number
): Promise<PositionRow> {
  const sql = `
    UPDATE positions
    SET stop_loss_price = $2, updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;
  const res = await query<PositionRow>(sql, [id, stopLossPrice]);
  return res.rows[0];
}

export async function closePosition(
  id: string,
  exitOrderId: string,
  status: 'CLOSED' | 'STOPPED_OUT' | 'TAKE_PROFIT'
): Promise<PositionRow> {
  const sql = `
    UPDATE positions
    SET
      status = $2,
      exit_order_id = $3,
      closed_at = NOW(),
      updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;
  const res = await query<PositionRow>(sql, [id, status, exitOrderId]);
  return res.rows[0];
}

export async function getPositionStats(symbol?: string) {
  let sql = `
    SELECT
      COUNT(*) as total_positions,
      SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) as open_positions,
      SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END) as closed_positions,
      SUM(CASE WHEN status = 'STOPPED_OUT' THEN 1 ELSE 0 END) as stopped_out,
      SUM(CASE WHEN status = 'TAKE_PROFIT' THEN 1 ELSE 0 END) as take_profit_hits,
      AVG(CASE WHEN status != 'OPEN' THEN pnl_percent ELSE NULL END) as avg_pnl_percent,
      SUM(CASE WHEN status != 'OPEN' THEN pnl_usdt ELSE NULL END) as total_pnl_usdt,
      SUM(CASE WHEN status = 'OPEN' THEN pnl_usdt ELSE 0 END) as unrealized_pnl_usdt
    FROM positions
  `;
  const params: unknown[] = [];

  if (symbol) {
    sql += ` WHERE symbol = $1`;
    params.push(symbol);
  }

  const res = await query(sql, params);
  return res.rows[0];
}

export async function getOpenPositionCountForSymbol(symbol: string): Promise<number> {
  const sql = `
    SELECT COUNT(*)::int AS cnt
    FROM positions
    WHERE symbol = $1 AND status = 'OPEN';
  `;
  const res = await query<{ cnt: number }>(sql, [symbol]);
  return res.rows[0]?.cnt ?? 0;
}
