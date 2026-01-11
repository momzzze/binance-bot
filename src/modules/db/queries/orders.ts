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
