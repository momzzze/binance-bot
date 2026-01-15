import type { Candle, SymbolCandles } from '../market/marketData.js';
import { computeSMA, computeEMA, computeRSI } from '../market/marketData.js';
import { createLogger } from '../../services/logger.js';
import { getActiveStrategyConfig, type StrategyConfigRow } from '../db/queries/strategy_config.js';

const log = createLogger('strategy');

// Cache strategy config (refresh periodically)
let cachedConfig: StrategyConfigRow | null = null;
let configLastFetch = 0;
const CONFIG_CACHE_MS = 60000; // 1 minute

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
      buy_score_threshold: 6, // Increased from 5 to be more selective
      sell_score_threshold: -5,
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
    reason: string;
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

  const currentPrice = candles[candles.length - 1].close;
  const smaShort = computeSMA(candles, config.sma_short_period);
  const smaLong = computeSMA(candles, config.sma_long_period);
  const emaShort = computeEMA(candles, config.ema_short_period);
  const emaLong = computeEMA(candles, config.ema_long_period);
  const rsi = computeRSI(candles, config.rsi_period);

  const meta = {
    currentPrice,
    sma20: smaShort ?? undefined,
    sma50: smaLong ?? undefined,
    ema12: emaShort ?? undefined,
    ema26: emaLong ?? undefined,
    rsi: rsi ?? undefined,
    reason: '',
  };

  // Calculate score based on conditions
  let score = 0;
  const reasons: string[] = [];

  log.debug(
    `${symbol}: Evaluating - price=${currentPrice.toFixed(2)}, SMA${config.sma_short_period}=${smaShort?.toFixed(2)}, SMA${config.sma_long_period}=${smaLong?.toFixed(2)}, EMA${config.ema_short_period}=${emaShort?.toFixed(2)}, EMA${config.ema_long_period}=${emaLong?.toFixed(2)}, RSI=${rsi?.toFixed(1)}`
  );

  // ============================
  // TREND FILTERS - PREVENT BUYING IN DOWNTRENDS
  // ============================

  // Filter 1: Price must be above SMA50 (long-term trend filter)
  if (smaLong !== null && currentPrice < smaLong) {
    log.debug(
      `  ❌ BLOCKED: Price ${currentPrice.toFixed(2)} below SMA${config.sma_long_period} ${smaLong.toFixed(2)} - DOWNTREND`
    );
    return {
      symbol,
      signal: 'HOLD',
      score: 0,
      meta: {
        ...meta,
        reason: `🚫 Bearish: Price below SMA${config.sma_long_period} (downtrend)`,
      },
    };
  }

  // Filter 2: Price must be above SMA20 (short-term trend filter)
  if (smaShort !== null && currentPrice < smaShort) {
    log.debug(
      `  ❌ BLOCKED: Price ${currentPrice.toFixed(2)} below SMA${config.sma_short_period} ${smaShort.toFixed(2)} - WEAK TREND`
    );
    return {
      symbol,
      signal: 'HOLD',
      score: 0,
      meta: {
        ...meta,
        reason: `🚫 Weak: Price below SMA${config.sma_short_period}`,
      },
    };
  }

  // Filter 3: Require Golden Cross (SMA20 > SMA50)
  if (smaShort !== null && smaLong !== null && smaShort <= smaLong) {
    log.debug(
      `  ❌ BLOCKED: No golden cross - SMA${config.sma_short_period} ${smaShort.toFixed(2)} <= SMA${config.sma_long_period} ${smaLong.toFixed(2)}`
    );
    return {
      symbol,
      signal: 'HOLD',
      score: 0,
      meta: {
        ...meta,
        reason: `🚫 No golden cross: SMA${config.sma_short_period} <= SMA${config.sma_long_period}`,
      },
    };
  }

  // Filter 4: EMA alignment check (EMA12 > EMA26)
  if (emaShort !== null && emaLong !== null && emaShort <= emaLong) {
    log.debug(
      `  ❌ BLOCKED: EMA bearish - EMA${config.ema_short_period} ${emaShort.toFixed(2)} <= EMA${config.ema_long_period} ${emaLong.toFixed(2)}`
    );
    return {
      symbol,
      signal: 'HOLD',
      score: 0,
      meta: {
        ...meta,
        reason: `🚫 EMA bearish: EMA${config.ema_short_period} <= EMA${config.ema_long_period}`,
      },
    };
  }

  // Filter 5: Check SMA50 is rising (not declining)
  if (candles.length >= config.sma_long_period + 10) {
    const sma50Previous = computeSMA(candles.slice(0, -10), config.sma_long_period);
    if (sma50Previous !== null && smaLong !== null && smaLong < sma50Previous * 0.998) {
      log.debug(
        `  ❌ BLOCKED: SMA${config.sma_long_period} declining - current ${smaLong.toFixed(2)} < previous ${sma50Previous.toFixed(2)}`
      );
      return {
        symbol,
        signal: 'HOLD',
        score: 0,
        meta: {
          ...meta,
          reason: `🚫 SMA${config.sma_long_period} declining (bear market)`,
        },
      };
    }
  }

  log.debug(`  ✅ TREND FILTERS PASSED - Bullish structure confirmed`);

  // SMA trend
  if (smaShort !== null && smaLong !== null) {
    if (smaShort > smaLong) {
      score += 3;
      reasons.push(`SMA${config.sma_short_period}>SMA${config.sma_long_period}`);
      log.debug(
        `  +3 SMA trend: ${config.sma_short_period}(${smaShort.toFixed(2)}) > ${config.sma_long_period}(${smaLong.toFixed(2)})`
      );
    } else if (smaShort < smaLong) {
      score -= 3;
      reasons.push(`SMA${config.sma_short_period}<SMA${config.sma_long_period}`);
      log.debug(
        `  -3 SMA trend: ${config.sma_short_period}(${smaShort.toFixed(2)}) < ${config.sma_long_period}(${smaLong.toFixed(2)})`
      );
    }
  }

  // EMA momentum
  if (emaShort !== null && emaLong !== null) {
    if (emaShort > emaLong) {
      score += 2;
      reasons.push(`EMA${config.ema_short_period}>EMA${config.ema_long_period}`);
      log.debug(
        `  +2 EMA momentum: ${config.ema_short_period}(${emaShort.toFixed(2)}) > ${config.ema_long_period}(${emaLong.toFixed(2)})`
      );
    } else if (emaShort < emaLong) {
      score -= 2;
      reasons.push(`EMA${config.ema_short_period}<EMA${config.ema_long_period}`);
      log.debug(
        `  -2 EMA momentum: ${config.ema_short_period}(${emaShort.toFixed(2)}) < ${config.ema_long_period}(${emaLong.toFixed(2)})`
      );
    }
  }

  // RSI conditions
  if (rsi !== null) {
    if (rsi < config.rsi_oversold) {
      score += 2;
      reasons.push(`RSI<${config.rsi_oversold} (oversold)`);
      log.debug(`  +2 RSI oversold: ${rsi.toFixed(1)} < ${config.rsi_oversold}`);
    } else if (rsi > config.rsi_overbought) {
      score -= 2;
      reasons.push(`RSI>${config.rsi_overbought} (overbought)`);
      log.debug(`  -2 RSI overbought: ${rsi.toFixed(1)} > ${config.rsi_overbought}`);
    }
    // Removed the weak RSI<50/RSI>50 bonus - too permissive
  }

  // Additional strength check: Require price above both EMAs
  if (emaShort !== null && emaLong !== null) {
    if (currentPrice > emaShort && currentPrice > emaLong) {
      score += 1;
      reasons.push('Price>EMAs');
      log.debug(`  +1 Price above both EMAs`);
    }
  }

  meta.reason = reasons.join(', ') || 'No clear signal';

  // Determine signal based on score thresholds from config
  let signal: Signal = 'HOLD';
  if (score >= config.buy_score_threshold) {
    signal = 'BUY';
  } else if (score <= config.sell_score_threshold) {
    signal = 'SELL';
  }

  // Log actionable signals (BUY/SELL)
  if (signal !== 'HOLD') {
    log.debug(`${symbol}: signal=${signal}, score=${score}, price=${currentPrice.toFixed(2)}`);
  }

  return { symbol, signal, score, meta };
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
