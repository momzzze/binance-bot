import { getDb } from '../db.js';

export interface CandleRow {
  id: number;
  symbol: string;
  interval: string;
  open_time: string; // bigint
  open: string; // numeric
  high: string;
  low: string;
  close: string;
  volume: string;
  close_time: string;
  quote_asset_volume: string | null;
  number_of_trades: number | null;
  taker_buy_base_asset_volume: string | null;
  taker_buy_quote_asset_volume: string | null;
  created_at: string;
}

export interface CandleInsert {
  symbol: string;
  interval: string;
  open_time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  close_time: number;
  quote_asset_volume?: number;
  number_of_trades?: number;
  taker_buy_base_asset_volume?: number;
  taker_buy_quote_asset_volume?: number;
}

/**
 * Insert candles (or update if already exists due to UNIQUE constraint)
 */
export async function insertCandles(candles: CandleInsert[]): Promise<void> {
  if (candles.length === 0) return;

  const db = getDb();
  const values = candles
    .map(
      (c, i) =>
        `($${i * 12 + 1}, $${i * 12 + 2}, $${i * 12 + 3}, $${i * 12 + 4}, $${i * 12 + 5}, $${i * 12 + 6}, $${i * 12 + 7}, $${i * 12 + 8}, $${i * 12 + 9}, $${i * 12 + 10}, $${i * 12 + 11}, $${i * 12 + 12})`
    )
    .join(',');

  const params = candles.flatMap((c) => [
    c.symbol,
    c.interval,
    c.open_time,
    c.open,
    c.high,
    c.low,
    c.close,
    c.volume,
    c.close_time,
    c.quote_asset_volume ?? null,
    c.number_of_trades ?? null,
    c.taker_buy_base_asset_volume ?? null,
  ]);

  const sql = `
    INSERT INTO candles (
      symbol, interval, open_time, open, high, low, close, volume, 
      close_time, quote_asset_volume, number_of_trades, taker_buy_base_asset_volume
    ) VALUES ${values}
    ON CONFLICT (symbol, interval, open_time) 
    DO UPDATE SET
      open = EXCLUDED.open,
      high = EXCLUDED.high,
      low = EXCLUDED.low,
      close = EXCLUDED.close,
      volume = EXCLUDED.volume,
      close_time = EXCLUDED.close_time,
      quote_asset_volume = EXCLUDED.quote_asset_volume,
      number_of_trades = EXCLUDED.number_of_trades,
      taker_buy_base_asset_volume = EXCLUDED.taker_buy_base_asset_volume
  `;

  await db.query(sql, params);
}

/**
 * Get candles for a symbol and interval within a time range
 */
export async function getCandles(
  symbol: string,
  interval: string,
  startTime?: number,
  endTime?: number,
  limit: number = 500
): Promise<CandleRow[]> {
  const db = getDb();
  let sql = `
    SELECT * FROM candles
    WHERE symbol = $1 AND interval = $2
  `;
  const params: (string | number)[] = [symbol, interval];

  if (startTime) {
    sql += ` AND open_time >= $${params.length + 1}`;
    params.push(startTime);
  }
  if (endTime) {
    sql += ` AND open_time <= $${params.length + 1}`;
    params.push(endTime);
  }

  sql += ` ORDER BY open_time DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const result = await db.query(sql, params);
  return result.rows;
}

/**
 * Get latest candle for a symbol and interval
 */
export async function getLatestCandle(symbol: string, interval: string): Promise<CandleRow | null> {
  const db = getDb();
  const result = await db.query(
    `SELECT * FROM candles 
     WHERE symbol = $1 AND interval = $2 
     ORDER BY open_time DESC 
     LIMIT 1`,
    [symbol, interval]
  );
  return result.rows[0] || null;
}

/**
 * Delete old candles (for cleanup/maintenance)
 */
export async function deleteOldCandles(daysToKeep: number = 30): Promise<number> {
  const db = getDb();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  const result = await db.query(`DELETE FROM candles WHERE created_at < $1`, [
    cutoffDate.toISOString(),
  ]);
  return result.rowCount || 0;
}
