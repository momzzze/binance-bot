import { query } from '../db.js';

export type OrderRow = {
  id: string;
  symbol: string;
  side: string;
  type: string;
  qty: number;
  status: string;
  binance_order_id?: string | null;
  client_order_id?: string | null;
  request_json?: unknown;
  response_json?: unknown;
  created_at: string;
  updated_at: string;
};

export async function insertOrder(row: Partial<OrderRow>) {
  const sql = `
    INSERT INTO orders (
      id, symbol, side, type, qty, status, binance_order_id, client_order_id, request_json, response_json
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
    ) RETURNING *;
  `;
  const params = [
    row.id,
    row.symbol,
    row.side,
    row.type,
    row.qty,
    row.status,
    row.binance_order_id ?? null,
    row.client_order_id ?? null,
    row.request_json ?? null,
    row.response_json ?? null,
  ];
  const res = await query<OrderRow>(sql, params);
  return res.rows[0];
}

export async function updateOrderStatus(id: string, status: string) {
  const sql = `
    UPDATE orders SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *;
  `;
  const res = await query<OrderRow>(sql, [id, status]);
  return res.rows[0];
}

export async function getOpenOrdersCountForSymbol(symbol: string): Promise<number> {
  const sql = `
    SELECT COUNT(*)::int AS cnt
    FROM orders
    WHERE symbol = $1 AND status IN ('NEW','PARTIALLY_FILLED','PENDING','OPEN');
  `;
  const res = await query<{ cnt: number }>(sql, [symbol]);
  return res.rows[0]?.cnt ?? 0;
}

/**
 * Gets all orders with optional filters
 */
export async function getOrders(
  symbol?: string,
  side?: string,
  limit: number = 100,
  offset: number = 0
): Promise<OrderRow[]> {
  let sql = `SELECT * FROM orders WHERE 1=1`;
  const params: unknown[] = [];
  let paramIndex = 1;

  if (symbol) {
    sql += ` AND symbol = $${paramIndex}`;
    params.push(symbol);
    paramIndex++;
  }

  if (side) {
    sql += ` AND side = $${paramIndex}`;
    params.push(side);
    paramIndex++;
  }

  sql += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  params.push(limit, offset);

  const res = await query<OrderRow>(sql, params);
  return res.rows;
}

/**
 * Gets trading statistics for a symbol
 */
export async function getOrderStats(symbol?: string) {
  let sql = `
    SELECT
      COUNT(*) as total_orders,
      SUM(CASE WHEN side = 'BUY' THEN 1 ELSE 0 END) as buy_orders,
      SUM(CASE WHEN side = 'SELL' THEN 1 ELSE 0 END) as sell_orders,
      SUM(CASE WHEN status = 'FILLED' THEN qty ELSE 0 END) as total_qty_filled,
      SUM(CASE WHEN status = 'FILLED' AND side = 'BUY' THEN qty ELSE 0 END) as buy_qty_filled,
      SUM(CASE WHEN status = 'FILLED' AND side = 'SELL' THEN qty ELSE 0 END) as sell_qty_filled,
      COUNT(CASE WHEN status = 'FILLED' THEN 1 END) as filled_count,
      COUNT(CASE WHEN status = 'CANCELED' THEN 1 END) as canceled_count
    FROM orders
  `;
  const params: unknown[] = [];

  if (symbol) {
    sql += ` WHERE symbol = $1`;
    params.push(symbol);
  }

  const res = await query(sql, params);
  return res.rows[0];
}
