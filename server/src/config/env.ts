import dotenv from 'dotenv';

export type BotConfig = {
  PORT: number;
  CORS_ORIGINS: string[];
  SYMBOLS: string[];
  INTERVAL: string; // e.g., '1m'
  TRADING_ENABLED: boolean;
  BOT_KILL_SWITCH: boolean;
  BASE_ASSET: string; // Base trading asset (USDC or USDT)
  MAX_ORDER_USDT: number;
  MAX_OPEN_ORDERS_PER_SYMBOL: number;
  MAX_TRADING_CAPITAL_PERCENT: number; // Max % of base asset to use for trading (e.g., 80 = 80%)
  MAX_POSITION_CAPITAL_PERCENT: number; // Max % of trading capital to allocate per single position (e.g., 30 = 30%)
  LOOP_MS: number;
  STRATEGY: 'simple' | 'marketcap' | 'macd'; // Strategy selection
  RISK_PER_TRADE_PERCENT: number; // Risk per trade as % of balance (e.g., 1 = 1%)
  STOP_LOSS_PERCENT: number; // Stop loss as percentage (e.g., 2 = 2%)
  TAKE_PROFIT_PERCENT: number; // Take profit as percentage (e.g., 10 = 10%)
  TRAILING_STOP_ENABLED: boolean; // Enable trailing stop loss
  TRAILING_STOP_ACTIVATION_PERCENT: number; // When to activate trailing (e.g., 5 = 5% profit)
  TRAILING_STOP_DISTANCE_PERCENT: number; // Distance from high (e.g., 3 = 3%)
  AUTO_SYMBOLS: boolean;
  AUTO_TOP_N: number;
  MIN_QUOTE_VOLUME_USDT: number;
  MANUAL_SYMBOLS: string[];
  EXCLUDE_SYMBOLS: string[];
  SYMBOL_REFRESH_MINUTES: number;
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

function toList(val: string | undefined, def: string): string[] {
  const source = val ?? def;
  return source
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadEnv(): BotConfig {
  dotenv.config();

  const SYMBOLS = toList(process.env.SYMBOLS, 'BTCUSDC,ETHUSDC');
  const MANUAL_SYMBOLS = toList(process.env.MANUAL_SYMBOLS, 'BTCUSDC,ETHUSDC');
  const EXCLUDE_SYMBOLS = toList(
    process.env.EXCLUDE_SYMBOLS,
    'BNBUPUSDC,BNBDOWNUSDC,BTCUPUSDC,BTCDOWNUSDC,ETHUPUSDC,ETHDOWNUSDC,USDCUSDT,TUSDUSDC,BUSDUSDC,FDUSDUSDC'
  );

  const cfg: BotConfig = {
    PORT: toNum(process.env.PORT, 3000),
    CORS_ORIGINS: toList(
      process.env.CORS_ORIGINS,
      'http://localhost:5173,http://localhost:5174,http://localhost:3001,http://localhost:3002'
    ),
    SYMBOLS,
    INTERVAL: process.env.INTERVAL ?? '1m',
    TRADING_ENABLED: toBool(process.env.TRADING_ENABLED, false),
    BOT_KILL_SWITCH: toBool(process.env.BOT_KILL_SWITCH, false),
    BASE_ASSET: process.env.BASE_ASSET ?? 'USDC',
    MAX_ORDER_USDT: toNum(process.env.MAX_ORDER_USDT, 20),
    MAX_OPEN_ORDERS_PER_SYMBOL: toNum(process.env.MAX_OPEN_ORDERS_PER_SYMBOL, 1),
    MAX_TRADING_CAPITAL_PERCENT: toNum(process.env.MAX_TRADING_CAPITAL_PERCENT, 80),
    MAX_POSITION_CAPITAL_PERCENT: toNum(process.env.MAX_POSITION_CAPITAL_PERCENT, 30),
    LOOP_MS: toNum(process.env.LOOP_MS, 5000),
    STRATEGY: (process.env.STRATEGY ?? 'simple') as 'simple' | 'marketcap' | 'macd',
    RISK_PER_TRADE_PERCENT: toNum(process.env.RISK_PER_TRADE_PERCENT, 1),
    STOP_LOSS_PERCENT: toNum(process.env.STOP_LOSS_PERCENT, 2),
    TAKE_PROFIT_PERCENT: toNum(process.env.TAKE_PROFIT_PERCENT, 8),
    TRAILING_STOP_ENABLED: toBool(process.env.TRAILING_STOP_ENABLED, true),
    TRAILING_STOP_ACTIVATION_PERCENT: toNum(process.env.TRAILING_STOP_ACTIVATION_PERCENT, 5),
    TRAILING_STOP_DISTANCE_PERCENT: toNum(process.env.TRAILING_STOP_DISTANCE_PERCENT, 3),
    AUTO_SYMBOLS: toBool(process.env.AUTO_SYMBOLS, false),
    AUTO_TOP_N: toNum(process.env.AUTO_TOP_N, 10),
    MIN_QUOTE_VOLUME_USDT: toNum(process.env.MIN_QUOTE_VOLUME_USDT, 5_000_000),
    MANUAL_SYMBOLS,
    EXCLUDE_SYMBOLS,
    SYMBOL_REFRESH_MINUTES: toNum(process.env.SYMBOL_REFRESH_MINUTES, 60),
    BINANCE_BASE_URL: process.env.BINANCE_BASE_URL ?? 'https://testnet.binance.vision',
    BINANCE_API_KEY: process.env.BINANCE_API_KEY ?? '',
    BINANCE_API_SECRET: process.env.BINANCE_API_SECRET ?? '',
    POSTGRES_URL:
      process.env.POSTGRES_URL ?? 'postgres://postgres:postgres@localhost:5432/binance_bot',
  };

  // Minimal validations
  if (!cfg.BINANCE_BASE_URL) throw new Error('BINANCE_BASE_URL is required');
  if (!cfg.INTERVAL) throw new Error('INTERVAL is required');
  if (!Number.isFinite(cfg.PORT) || cfg.PORT <= 0 || cfg.PORT > 65535)
    throw new Error('PORT must be a valid TCP port');

  return cfg;
}
