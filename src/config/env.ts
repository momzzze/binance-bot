import dotenv from 'dotenv';

export type BotConfig = {
  SYMBOLS: string[];
  INTERVAL: string; // e.g., '1m'
  TRADING_ENABLED: boolean;
  BOT_KILL_SWITCH: boolean;
  MAX_ORDER_USDT: number;
  MAX_OPEN_ORDERS_PER_SYMBOL: number;
  LOOP_MS: number;
  BINANCE_BASE_URL: string;
  BINANCE_API_KEY: string;
  BINANCE_API_SECRET: string;
  POSTGRES_URL: string;
};

function toBool(val: string | undefined, def: boolean): boolean {
  if (val === undefined || val === '') return def;
  return val.toLowerCase() === 'true';
}

function toNum(val: string | undefined, def: number): number {
  if (val === undefined || val === '') return def;
  const n = Number(val);
  return Number.isFinite(n) ? n : def;
}

export function loadEnv(): BotConfig {
  dotenv.config();

  const SYMBOLS = (process.env.SYMBOLS ?? 'BTCUSDT,ETHUSDT')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const cfg: BotConfig = {
    SYMBOLS,
    INTERVAL: process.env.INTERVAL ?? '1m',
    TRADING_ENABLED: toBool(process.env.TRADING_ENABLED, false),
    BOT_KILL_SWITCH: toBool(process.env.BOT_KILL_SWITCH, false),
    MAX_ORDER_USDT: toNum(process.env.MAX_ORDER_USDT, 20),
    MAX_OPEN_ORDERS_PER_SYMBOL: toNum(process.env.MAX_OPEN_ORDERS_PER_SYMBOL, 1),
    LOOP_MS: toNum(process.env.LOOP_MS, 5000),
    BINANCE_BASE_URL: process.env.BINANCE_BASE_URL ?? 'https://testnet.binance.vision',
    BINANCE_API_KEY: process.env.BINANCE_API_KEY ?? '',
    BINANCE_API_SECRET: process.env.BINANCE_API_SECRET ?? '',
    POSTGRES_URL:
      process.env.POSTGRES_URL ?? 'postgres://postgres:postgres@localhost:5432/binance_bot',
  };

  // Minimal validations
  if (!cfg.BINANCE_BASE_URL) throw new Error('BINANCE_BASE_URL is required');
  if (!cfg.INTERVAL) throw new Error('INTERVAL is required');

  return cfg;
}
