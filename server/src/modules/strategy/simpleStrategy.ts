import type { Candle, SymbolCandles } from '../market/marketData.js';
import { computeSMA, computeEMA, computeRSI, computeCCI } from '../market/marketData.js';
import { createLogger } from '../../services/logger.js';
import { getActiveStrategyConfig, type StrategyConfigRow } from '../db/queries/strategy_config.js';

const log = createLogger('strategy');

// Cache strategy config (refresh periodically)
let cachedConfig: StrategyConfigRow | null = null;
let configLastFetch = 0;
const CONFIG_CACHE_MS = 60000; // 1 minute
const MOMENTUM_PERIOD = 10;
const MOMENTUM_THRESHOLD = 0.5; // percentage
const CCI_PERIOD = 20;
const CCI_BULLISH = 100;
const CCI_BEARISH = -100;

async function getStrategyParams(): Promise<StrategyConfigRow> {
  const now = Date.now();
  if (cachedConfig && now - configLastFetch < CONFIG_CACHE_MS) {
    return cachedConfig;
  }

  const config = await getActiveStrategyConfig();
  if (!config) {
    // Fallback to defaults if no config in DB
    log.warn('No active strategy config found, using defaults');
    return {
      id: 0,
      strategy_name: 'default',
      is_active: true,
      sma_short_period: 20,
      sma_long_period: 50,
      ema_short_period: 12,
      ema_long_period: 26,
      rsi_period: 14,
      rsi_overbought: 70,
      rsi_oversold: 30,
      buy_score_threshold: 2,
      sell_score_threshold: -2,
      stop_loss_percent: '4.0',
      take_profit_percent: '5.0',
      trailing_stop_enabled: true,
      trailing_stop_activation_percent: '3.0',
      trailing_stop_distance_percent: '2.0',
      risk_per_trade_percent: '2.0',
      min_volume_usdt: '1000000',
      require_volume_spike: false,
      volume_spike_multiplier: '1.5',
      description: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  cachedConfig = config;
  configLastFetch = now;
  return config;
}

export type Signal = 'BUY' | 'SELL' | 'HOLD';

export interface Decision {
  symbol: string;
  signal: Signal;
  score: number;
  meta: {
    currentPrice: number;
    sma20?: number;
    sma50?: number;
    ema12?: number;
    ema26?: number;
    rsi?: number;
    cci?: number;
    momentum?: number;
    trend4hGain?: number;
    price4hAgo?: number;
    priceNow?: number;
    reason: string;
  };
}

/**
 * Checks if the price has positive momentum in recent candles (last 5-10 candles)
 * Returns the percentage gain in recent period
 */
function calculateRecentMomentum(candles: Candle[], periods: number = 5): number {
  if (candles.length < periods) return 0;

  const recentStart = candles[candles.length - periods];
  const recentEnd = candles[candles.length - 1];

  if (!recentStart || !recentEnd) return 0;

  return ((recentEnd.close - recentStart.close) / recentStart.close) * 100;
}

/**
 * Calculates 4-hour trend
 * Assuming 1-minute candles, 4 hours = 240 candles
 */
function calculate4HourTrend(candles: Candle[]): {
  gain: number;
  priceNow: number;
  price4hAgo: number;
} {
  const candles4h = 240; // 4 hours * 60 minutes

  if (candles.length < candles4h) {
    // Not enough data, use what we have
    const oldestCandle = candles[0];
    const latestCandle = candles[candles.length - 1];
    if (!oldestCandle || !latestCandle) {
      return { gain: 0, priceNow: 0, price4hAgo: 0 };
    }
    const gain = ((latestCandle.close - oldestCandle.close) / oldestCandle.close) * 100;
    return {
      gain,
      priceNow: latestCandle.close,
      price4hAgo: oldestCandle.close,
    };
  }

  const candle4hAgo = candles[candles.length - candles4h];
  const candleNow = candles[candles.length - 1];

  if (!candle4hAgo || !candleNow) {
    return { gain: 0, priceNow: 0, price4hAgo: 0 };
  }

  const gain = ((candleNow.close - candle4hAgo.close) / candle4hAgo.close) * 100;

  return {
    gain,
    priceNow: candleNow.close,
    price4hAgo: candle4hAgo.close,
  };
}

/**
 * Simple strategy based on SMA crossover, EMA, and RSI.
 * Now reads configuration from database!
 *
 * BUY signals:
 * - SMA(short) > SMA(long) (bullish trend)
 * - EMA(short) > EMA(long) (short-term momentum)
 * - RSI < overbought threshold (not overbought)
 * - Price has positive recent momentum (not falling)
 *
 * SELL signals:
 * - SMA(short) < SMA(long) (bearish trend)
 * - EMA(short) < EMA(long) (short-term weakness)
 * - RSI > oversold threshold (not oversold)
 *
 * HOLD otherwise.
 */
export async function computeSignal(symbolCandles: SymbolCandles): Promise<Decision> {
  const { symbol, candles } = symbolCandles;

  if (candles.length === 0) {
    return {
      symbol,
      signal: 'HOLD',
      score: 0,
      meta: {
        currentPrice: 0,
        reason: 'No candle data available',
      },
    };
  }

  // Get strategy configuration from database
  const config = await getStrategyParams();
  const minCandles = Math.max(config.sma_long_period, config.ema_long_period, config.rsi_period);

  if (candles.length < minCandles) {
    return {
      symbol,
      signal: 'HOLD',
      score: 0,
      meta: {
        currentPrice: candles[candles.length - 1]?.close ?? 0,
        reason: `Insufficient candles for analysis (need ${minCandles})`,
      },
    };
  }

  const lastCandle = candles[candles.length - 1];
  if (!lastCandle) {
    return {
      symbol,
      signal: 'HOLD',
      score: 0,
      meta: {
        currentPrice: 0,
        reason: 'No candle data available',
      },
    };
  }

  const currentPrice = lastCandle.close;
  const smaShort = computeSMA(candles, config.sma_short_period);
  const smaLong = computeSMA(candles, config.sma_long_period);
  const ma7 = computeSMA(candles, 7);
  const ma99 = computeSMA(candles, 99);
  const emaShort = computeEMA(candles, config.ema_short_period);
  const emaLong = computeEMA(candles, config.ema_long_period);
  const rsi = computeRSI(candles, config.rsi_period);
  const cci = computeCCI(candles, CCI_PERIOD);
  const recentMomentum = calculateRecentMomentum(candles, MOMENTUM_PERIOD);

  // Calculate 4-hour trend
  const trend4h = calculate4HourTrend(candles);

  const meta = {
    currentPrice,
    sma20: smaShort ?? undefined,
    sma50: smaLong ?? undefined,
    ma7: ma7 ?? undefined,
    ma99: ma99 ?? undefined,
    ema12: emaShort ?? undefined,
    ema26: emaLong ?? undefined,
    rsi: rsi ?? undefined,
    cci: cci ?? undefined,
    momentum: recentMomentum,
    trend4hGain: trend4h.gain,
    price4hAgo: trend4h.price4hAgo,
    priceNow: trend4h.priceNow,
    reason: '',
  };

  const checks = [
    {
      name: 'trend_sma',
      pass: smaShort !== null && smaLong !== null && smaShort > smaLong,
      reason: `SMA trend (${config.sma_short_period}>${config.sma_long_period}) must be up`,
    },
    {
      name: 'price_above_short',
      pass: smaShort !== null && currentPrice > smaShort,
      reason: 'Price must be above short SMA',
    },
    {
      name: 'ma7_gt_ma99',
      pass: ma7 !== null && ma99 !== null && ma7 > ma99,
      reason: 'MA7 must be above MA99',
    },
    {
      name: 'momentum',
      pass: recentMomentum > MOMENTUM_THRESHOLD,
      reason: `Momentum must be positive > ${MOMENTUM_THRESHOLD}%`,
    },
    {
      name: 'rsi_band',
      pass: rsi !== null && rsi > config.rsi_oversold && rsi < config.rsi_overbought,
      reason: `RSI must be between ${config.rsi_oversold} and ${config.rsi_overbought}`,
    },
    {
      name: 'cci',
      pass: cci !== null && cci > 0,
      reason: 'CCI must be above 0',
    },
  ];

  const failed = checks.filter((c) => !c.pass);
  const passed = checks.length - failed.length;

  if (failed.length > 0) {
    meta.reason = `HOLD: ${failed.map((f) => f.reason).join(' | ')}`;
    log.debug(
      `${symbol}: HOLD (failed ${failed.length}/${checks.length}) momentum=${recentMomentum.toFixed(2)}%, rsi=${rsi?.toFixed(1)}, cci=${cci?.toFixed(1)}, price=${currentPrice.toFixed(4)}`
    );
    return { symbol, signal: 'HOLD', score: passed - failed.length, meta };
  }

  meta.reason = `BUY: all ${checks.length} signals passed`;
  log.debug(
    `${symbol}: BUY with confluence momentum=${recentMomentum.toFixed(2)}%, rsi=${rsi?.toFixed(1)}, cci=${cci?.toFixed(1)}, price=${currentPrice.toFixed(4)}`
  );
  return { symbol, signal: 'BUY', score: passed, meta };
}

/**
 * Computes signals for multiple symbols.
 */
export async function computeMultiSymbolSignals(
  symbolCandlesArray: SymbolCandles[]
): Promise<Decision[]> {
  const decisions = await Promise.all(symbolCandlesArray.map(computeSignal));
  return decisions;
}
