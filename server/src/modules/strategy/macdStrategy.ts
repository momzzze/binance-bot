import type { BinanceClient } from '../exchange/binanceClient.js';
import type { Candle } from '../market/marketData.js';
import { fetchCandles } from '../market/marketData.js';
import { createLogger } from '../../services/logger.js';

const log = createLogger('strategy/macd');

const D1_LIMIT = 80;
const H4_LIMIT = 100;
const H1_LIMIT = 100;
const H4_CROSS_LOOKBACK = 20;
const H4_STATS_LOOKBACK = 120;
const MIN_D1_MACD_POINTS = 10;
const MIN_H4_MACD_POINTS = 30;

// Type for MACD computation results
interface MacdPoint {
  timestamp: number;
  macd: number;
  signal: number;
  histogram: number;
}

// Decision interface similar to existing strategies
export interface MacdDecision {
  symbol: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  score: number;
  meta: {
    currentPrice: number;
    reason: string;
    d1Bias?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    h4CrossoverPrice?: number;
    h4CrossoverStrength?: string;
    h1HistogramConfirm?: boolean;
    macdDebug?: {
      d1?: MacdPoint;
      h4?: MacdPoint;
      h1?: MacdPoint;
    };
  };
}

/**
 * Computes EMA for an array of values with full-length aligned output (O(n) implementation).
 * Returns array of same length as input, with null for indices before enough data.
 * This ensures indices stay aligned (emaValues[i] corresponds to values[i]).
 */
function emaSeriesAligned(values: number[], period: number): (number | null)[] {
  if (values.length === 0 || period < 1) return [];

  const out: (number | null)[] = new Array(values.length).fill(null);
  const k = 2 / (period + 1);

  if (values.length < period) return out;

  // SMA seed at index period-1 (when we have enough data)
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  let ema = sum / period;
  out[period - 1] = ema;

  // EMA continues from period to end
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out[i] = ema;
  }

  return out;
}

/**
 * Computes MACD (12, 26, 9) series for a list of candles.
 * MACD = EMA(12) - EMA(26)
 * Signal = EMA(9) of MACD
 * Histogram = MACD - Signal
 * Note: Series skips early points until both MACD and Signal are available.
 */
function computeMacdSeries(candles: Candle[]): MacdPoint[] {
  if (candles.length < 26) {
    return [];
  }

  // Extract close prices
  const closes = candles.map((c) => c.close);

  // Compute aligned EMA12 and EMA26 in O(n)
  const ema12Values = emaSeriesAligned(closes, 12);
  const ema26Values = emaSeriesAligned(closes, 26);

  // Compute raw MACD values (EMA12 - EMA26), aligned
  const macdRawValues: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    const ema12 = ema12Values[i];
    const ema26 = ema26Values[i];
    if (ema12 === null || ema26 === null) {
      macdRawValues.push(null);
    } else {
      macdRawValues.push(ema12 - ema26);
    }
  }

  // Compute Signal line (EMA9 of MACD), but filter nulls for EMA computation
  const macdNonNull = macdRawValues.filter((v) => v !== null) as number[];
  const signalNonNull = emaSeriesAligned(macdNonNull, 9);

  // Map signal values back to full-length aligned array
  const signalValues: (number | null)[] = new Array(macdRawValues.length).fill(null);
  let signalIdx = 0;
  for (let i = 0; i < macdRawValues.length; i++) {
    if (macdRawValues[i] !== null) {
      signalValues[i] = signalNonNull[signalIdx] ?? null;
      signalIdx++;
    }
  }

  // Build MacdPoint array (skip until both MACD and Signal are available)
  const macdSeries: MacdPoint[] = [];
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const macd = macdRawValues[i];
    const signal = signalValues[i];

    if (!candle || macd === null || signal === null) {
      continue;
    }

    macdSeries.push({
      timestamp: candle.openTime,
      macd,
      signal,
      histogram: macd - signal,
    });
  }

  return macdSeries;
}

/**
 * Compute percentile stats (min, max, p25, p50, p75) of MACD values.
 * Used to define "far from zero" thresholds relative to the asset.
 */
function computeMacdStats(macdSeries: MacdPoint[], lookback: number) {
  const macdValues = macdSeries.slice(-lookback).map((p) => p.macd);
  if (macdValues.length === 0) {
    return { min: 0, max: 0, p25: 0, p50: 0, p75: 0 };
  }

  macdValues.sort((a, b) => a - b);
  const len = macdValues.length;

  const percentile = (p: number) => {
    const idx = Math.ceil((p / 100) * len) - 1;
    return macdValues[Math.max(0, idx)];
  };

  return {
    min: macdValues[0],
    max: macdValues[len - 1],
    p25: percentile(25),
    p50: percentile(50),
    p75: percentile(75),
  };
}

/**
 * Gate 1: Daily Bias (from pre-computed MACD series)
 * - Return 'BULLISH' if macd > signal > 0 and separated by a minimal distance.
 * - Return 'BEARISH' if macd < signal < 0 and separated.
 * - Otherwise return 'NEUTRAL'.
 * - Uses relative separation threshold (5% of MACD range) to be crypto-safe.
 */
function computeDailyBiasFromSeries(macdSeries: MacdPoint[]): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  if (macdSeries.length < MIN_D1_MACD_POINTS) {
    return 'NEUTRAL';
  }

  const latestMacd = macdSeries[macdSeries.length - 1];
  if (!latestMacd) {
    return 'NEUTRAL';
  }

  // Compute stats for relative separation threshold (crypto-safe)
  const stats = computeMacdStats(macdSeries, macdSeries.length);
  const macdRange = stats.max - stats.min;

  // If MACD range is effectively zero, market is choppy/neutral
  if (macdRange <= 0) {
    return 'NEUTRAL';
  }

  const minSeparation = macdRange * 0.05; // 5% of range (tunable)

  // BULLISH: MACD > Signal > 0
  if (latestMacd.macd > latestMacd.signal && latestMacd.signal > 0) {
    const separation = latestMacd.macd - latestMacd.signal;
    if (separation > minSeparation) {
      return 'BULLISH';
    }
  }

  // BEARISH: MACD < Signal < 0
  if (latestMacd.macd < latestMacd.signal && latestMacd.signal < 0) {
    const separation = latestMacd.signal - latestMacd.macd;
    if (separation > minSeparation) {
      return 'BEARISH';
    }
  }

  return 'NEUTRAL';
}

/**
 * Find the most recent MACD crossover in the series.
 * Crossover: MACD crosses Signal (either direction).
 * Returns absolute index in macdSeries of crossover candle, or -1 if not found.
 */
function findRecentCrossover(
  macdSeries: MacdPoint[],
  lookback: number = H4_CROSS_LOOKBACK
): number {
  const start = Math.max(1, macdSeries.length - lookback);

  // Search backwards from end
  for (let i = macdSeries.length - 1; i >= start; i--) {
    const curr = macdSeries[i];
    const prev = macdSeries[i - 1];
    if (!curr || !prev) continue;

    // Explicit crossover detection (bullish or bearish)
    const bullish = prev.macd <= prev.signal && curr.macd > curr.signal;
    const bearish = prev.macd >= prev.signal && curr.macd < curr.signal;

    if (bullish || bearish) return i;
  }

  return -1;
}

/**
 * Gate 2: H4 Trend Signal
 * - Find the most recent MACD crossover (macd crosses signal).
 * - Ensure crossover direction matches daily bias.
 * - Ensure MACD value at crossover is "far from zero" using percentiles (p75/p25).
 */
function computeH4Signal(
  macdSeries: MacdPoint[],
  bias: 'BULLISH' | 'BEARISH'
): {
  direction: 'LONG' | 'SHORT' | 'NONE';
  recentCrossIndex: number;
  strengthOk: boolean;
  strengthReason?: string; // 'NO_CROSSOVER' | 'WEAK' | 'OK' | 'BIAS_MISMATCH'
} {
  if (macdSeries.length < MIN_H4_MACD_POINTS) {
    return {
      direction: 'NONE',
      recentCrossIndex: -1,
      strengthOk: false,
      strengthReason: 'NO_CROSSOVER',
    };
  }

  const crossoverIdx = findRecentCrossover(macdSeries, H4_CROSS_LOOKBACK);

  if (crossoverIdx < 0) {
    return {
      direction: 'NONE',
      recentCrossIndex: -1,
      strengthOk: false,
      strengthReason: 'NO_CROSSOVER',
    };
  }

  const crossoverPoint = macdSeries[crossoverIdx];
  if (!crossoverPoint) {
    return {
      direction: 'NONE',
      recentCrossIndex: -1,
      strengthOk: false,
      strengthReason: 'NO_CROSSOVER',
    };
  }

  // Determine if crossover is bullish or bearish
  const prevPoint = macdSeries[crossoverIdx - 1];
  if (!prevPoint) {
    return {
      direction: 'NONE',
      recentCrossIndex: -1,
      strengthOk: false,
      strengthReason: 'NO_CROSSOVER',
    };
  }

  const isBullishCrossover =
    prevPoint.macd <= prevPoint.signal && crossoverPoint.macd > crossoverPoint.signal;
  const isBearishCrossover =
    prevPoint.macd >= prevPoint.signal && crossoverPoint.macd < crossoverPoint.signal;

  // Match with daily bias
  let direction: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
  if (isBullishCrossover && bias === 'BULLISH') {
    direction = 'LONG';
  } else if (isBearishCrossover && bias === 'BEARISH') {
    direction = 'SHORT';
  }

  if (direction === 'NONE') {
    return {
      direction: 'NONE',
      recentCrossIndex: crossoverIdx,
      strengthOk: false,
      strengthReason: 'BIAS_MISMATCH',
    };
  }

  // Check if MACD is "far from zero" using percentiles (crypto-safe strength check)
  const stats = computeMacdStats(macdSeries, Math.min(H4_STATS_LOOKBACK, macdSeries.length));
  let strengthOk = false;
  let strengthReason = '';

  if (direction === 'LONG') {
    strengthOk = crossoverPoint.macd >= stats.p75;
    strengthReason = strengthOk ? 'OK' : 'WEAK';
  } else if (direction === 'SHORT') {
    strengthOk = crossoverPoint.macd <= stats.p25;
    strengthReason = strengthOk ? 'OK' : 'WEAK';
  }

  return { direction, recentCrossIndex: crossoverIdx, strengthOk, strengthReason };
}

/**
 * Gate 3: H1 Histogram Confirmation
 * - Compute MACD on 1H candles.
 * - Check that histogram is expanding in the direction of the bias (2 of last 3 bars).
 * - Uses "2 of 3" logic to tolerate single noisy candles in crypto.
 */
function confirmH1Histogram(macdSeries: MacdPoint[], biasDirection: 'LONG' | 'SHORT'): boolean {
  if (macdSeries.length < 3) {
    return false;
  }

  // Look at the last 3 histograms
  const h0 = macdSeries[macdSeries.length - 3]?.histogram ?? 0; // oldest
  const h1 = macdSeries[macdSeries.length - 2]?.histogram ?? 0; // middle
  const h2 = macdSeries[macdSeries.length - 1]?.histogram ?? 0; // newest

  if (biasDirection === 'LONG') {
    // All must be positive
    if (!(h0 > 0 && h1 > 0 && h2 > 0)) {
      return false;
    }
    // At least 2 of 3 increasing: (h1>h0) + (h2>h1) >= 1
    const increases = (h1 > h0 ? 1 : 0) + (h2 > h1 ? 1 : 0);
    return increases >= 1;
  }

  if (biasDirection === 'SHORT') {
    // All must be negative
    if (!(h0 < 0 && h1 < 0 && h2 < 0)) {
      return false;
    }
    // At least 2 of 3 decreasing: (h1<h0) + (h2<h1) >= 1
    const decreases = (h1 < h0 ? 1 : 0) + (h2 < h1 ? 1 : 0);
    return decreases >= 1;
  }

  return false;
}

/**
 * Top-level decision for a single symbol.
 * Implements the 3-gate MACD strategy:
 * 1. Daily bias (D1 MACD trend direction)
 * 2. H4 crossover with strength check
 * 3. H1 histogram confirmation
 */
export async function computeMacdDecision(
  client: BinanceClient,
  symbol: string
): Promise<MacdDecision> {
  try {
    // Fetch all candles upfront (once per timeframe)
    const [d1Candles, h4Candles, h1Candles] = await Promise.all([
      fetchCandles(client, symbol, '1d', D1_LIMIT),
      fetchCandles(client, symbol, '4h', H4_LIMIT),
      fetchCandles(client, symbol, '1h', H1_LIMIT),
    ]);

    // Gate 1: Determine daily bias
    if (d1Candles.length < 26) {
      return {
        symbol,
        signal: 'HOLD',
        score: 0,
        meta: {
          currentPrice: 0,
          reason: 'Insufficient D1 candles',
        },
      };
    }

    const d1Macd = computeMacdSeries(d1Candles);
    const d1Bias = computeDailyBiasFromSeries(d1Macd);

    if (d1Bias === 'NEUTRAL') {
      return {
        symbol,
        signal: 'HOLD',
        score: 0,
        meta: {
          currentPrice: 0,
          reason: 'Daily bias neutral',
          d1Bias: 'NEUTRAL',
        },
      };
    }

    // Gate 2: Compute H4 MACD series and evaluate trend signal
    if (h4Candles.length < 26) {
      return {
        symbol,
        signal: 'HOLD',
        score: 0,
        meta: {
          currentPrice: 0,
          reason: 'Insufficient H4 candles',
          d1Bias,
        },
      };
    }

    const h4Macd = computeMacdSeries(h4Candles);
    const h4Signal = computeH4Signal(h4Macd, d1Bias);

    if (h4Signal.direction === 'NONE' || !h4Signal.strengthOk) {
      const reasonMsg =
        h4Signal.strengthReason === 'NO_CROSSOVER'
          ? 'No H4 crossover found in recent lookback'
          : h4Signal.strengthReason === 'BIAS_MISMATCH'
            ? 'H4 crossover direction mismatches D1 bias'
            : 'H4 crossover strength insufficient (below percentile threshold)';
      return {
        symbol,
        signal: 'HOLD',
        score: 0,
        meta: {
          currentPrice: 0,
          reason: `H4 trend gate failed: ${reasonMsg}`,
          d1Bias,
          h4CrossoverPrice: h4Macd[h4Signal.recentCrossIndex]?.macd,
          h4CrossoverStrength: h4Signal.strengthReason,
        },
      };
    }

    // Gate 3: Compute H1 MACD series and confirm histogram
    if (h1Candles.length < 26) {
      return {
        symbol,
        signal: 'HOLD',
        score: 0,
        meta: {
          currentPrice: 0,
          reason: 'Insufficient H1 candles',
          d1Bias,
          h4CrossoverPrice: h4Macd[h4Signal.recentCrossIndex]?.macd,
        },
      };
    }

    const h1Macd = computeMacdSeries(h1Candles);
    const h1Confirm = confirmH1Histogram(h1Macd, h4Signal.direction);

    if (!h1Confirm) {
      return {
        symbol,
        signal: 'HOLD',
        score: 0,
        meta: {
          currentPrice: h1Candles[h1Candles.length - 1]?.close ?? 0,
          reason: 'H1 histogram not confirming',
          d1Bias,
          h4CrossoverPrice: h4Macd[h4Signal.recentCrossIndex]?.macd,
          h1HistogramConfirm: false,
        },
      };
    }

    // All gates passed: return BUY or SELL with a score
    const currentPrice = h1Candles[h1Candles.length - 1]?.close ?? 0;
    const score = 3; // Consistent positive score when all conditions are met

    return {
      symbol,
      signal: h4Signal.direction === 'LONG' ? 'BUY' : 'SELL',
      score,
      meta: {
        currentPrice,
        reason: 'All MACD gates passed (D1 bias + H4 crossover + H1 confirmation)',
        d1Bias,
        h4CrossoverPrice: h4Macd[h4Signal.recentCrossIndex]?.macd,
        h4CrossoverStrength: h4Signal.strengthReason ?? 'OK',
        h1HistogramConfirm: true,
        macdDebug: {
          d1: d1Macd[d1Macd.length - 1],
          h4: h4Macd[h4Macd.length - 1],
          h1: h1Macd[h1Macd.length - 1],
        },
      },
    };
  } catch (err) {
    log.error(`${symbol}: Error computing MACD decision:`, err);
    return {
      symbol,
      signal: 'HOLD',
      score: 0,
      meta: {
        currentPrice: 0,
        reason: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      },
    };
  }
}

/**
 * Multi-symbol wrapper - similar to existing strategies.
 */
export async function computeMultiSymbolSignals(
  client: BinanceClient,
  symbols: string[]
): Promise<MacdDecision[]> {
  const results: MacdDecision[] = [];

  for (const symbol of symbols) {
    try {
      const decision = await computeMacdDecision(client, symbol);
      results.push(decision);
    } catch (err) {
      log.error(`${symbol}: Error in multi-symbol computation:`, err);
      results.push({
        symbol,
        signal: 'HOLD',
        score: 0,
        meta: {
          currentPrice: 0,
          reason: 'Error computing decision',
        },
      });
    }
  }

  return results;
}
