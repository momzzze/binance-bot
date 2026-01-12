import { getDb } from '../db.js';

export interface StrategyConfigRow {
  id: number;
  strategy_name: string;
  is_active: boolean;
  sma_short_period: number;
  sma_long_period: number;
  ema_short_period: number;
  ema_long_period: number;
  rsi_period: number;
  rsi_overbought: number;
  rsi_oversold: number;
  buy_score_threshold: number;
  sell_score_threshold: number;
  stop_loss_percent: string; // numeric
  take_profit_percent: string;
  trailing_stop_enabled: boolean;
  trailing_stop_activation_percent: string;
  trailing_stop_distance_percent: string;
  risk_per_trade_percent: string;
  min_volume_usdt: string;
  require_volume_spike: boolean;
  volume_spike_multiplier: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface StrategyConfigUpdate {
  sma_short_period?: number;
  sma_long_period?: number;
  ema_short_period?: number;
  ema_long_period?: number;
  rsi_period?: number;
  rsi_overbought?: number;
  rsi_oversold?: number;
  buy_score_threshold?: number;
  sell_score_threshold?: number;
  stop_loss_percent?: number;
  take_profit_percent?: number;
  trailing_stop_enabled?: boolean;
  trailing_stop_activation_percent?: number;
  trailing_stop_distance_percent?: number;
  risk_per_trade_percent?: number;
  min_volume_usdt?: number;
  require_volume_spike?: boolean;
  volume_spike_multiplier?: number;
  description?: string;
}

/**
 * Get active strategy configuration
 */
export async function getActiveStrategyConfig(): Promise<StrategyConfigRow | null> {
  const db = getDb();
  const result = await db.query(`SELECT * FROM strategy_config WHERE is_active = true LIMIT 1`);
  return result.rows[0] || null;
}

/**
 * Get strategy by name
 */
export async function getStrategyConfigByName(name: string): Promise<StrategyConfigRow | null> {
  const db = getDb();
  const result = await db.query(`SELECT * FROM strategy_config WHERE strategy_name = $1`, [name]);
  return result.rows[0] || null;
}

/**
 * Get all strategies
 */
export async function getAllStrategyConfigs(): Promise<StrategyConfigRow[]> {
  const db = getDb();
  const result = await db.query(
    `SELECT * FROM strategy_config ORDER BY is_active DESC, strategy_name ASC`
  );
  return result.rows;
}

/**
 * Update strategy configuration
 */
export async function updateStrategyConfig(
  strategyName: string,
  updates: StrategyConfigUpdate
): Promise<StrategyConfigRow | null> {
  const db = getDb();

  const fields: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined) {
      fields.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  });

  if (fields.length === 0) {
    return getStrategyConfigByName(strategyName);
  }

  fields.push(`updated_at = NOW()`);
  values.push(strategyName);

  const sql = `
    UPDATE strategy_config 
    SET ${fields.join(', ')}
    WHERE strategy_name = $${paramIndex}
    RETURNING *
  `;

  const result = await db.query(sql, values);
  return result.rows[0] || null;
}

/**
 * Set active strategy (deactivates all others)
 */
export async function setActiveStrategy(strategyName: string): Promise<void> {
  const db = getDb();
  await db.query(`UPDATE strategy_config SET is_active = false`);
  await db.query(`UPDATE strategy_config SET is_active = true WHERE strategy_name = $1`, [
    strategyName,
  ]);
}
