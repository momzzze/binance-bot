import { query } from '../db.js';

export async function setState(key: string, value: string) {
  const sql = `
    INSERT INTO bot_state(key, value, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
  `;
  await query(sql, [key, value]);
}

export async function getState(key: string): Promise<string | null> {
  const res = await query<{ value: string }>('SELECT value FROM bot_state WHERE key = $1', [key]);
  return res.rows[0]?.value ?? null;
}

export async function getKillSwitch(): Promise<boolean> {
  const v = await getState('KILL_SWITCH');
  return (v ?? 'false').toLowerCase() === 'true';
}

export async function getTradingEnabled(): Promise<boolean> {
  const v = await getState('TRADING_ENABLED');
  return (v ?? 'false').toLowerCase() === 'true';
}
