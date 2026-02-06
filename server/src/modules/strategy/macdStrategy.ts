import type { BinanceClient } from '../exchange/binanceClient.js';
import type { Candle } from '../market/marketData.js';
import { fetchCandles } from '../market/marketData.js';
import { createLogger } from '../../services/logger.js';

const log = createLogger('strategy/macd');

// Testnet-compatible timeframes: H1 (bias) / 15m (crossover) / 5m (confirmation)
const H1_LIMIT = 120; // H1 for bias
const M15_LIMIT = 200; // 15m for crossover
const M5_LIMIT = 300; // 5m for confirmation
const M15_CROSS_LOOKBACK = 20;
const M15_STATS_LOOKBACK = 120;
const MIN_H1_MACD_POINTS = 30;
const MIN_M15_MACD_POINTS = 40;

interface MacdPoint {
  timestamp: number;
  macd: number;
  signal: number;
  histogram: number;
}

export interface MacdDecision {
  symbol: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  score: number;
  meta: {
    currentPrice: number;
    reason: string;
    h1Bias?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    m15CrossoverPrice?: number;
    m15CrossoverStrength?: string;
    m5HistogramConfirm?: boolean;
    macdDebug?: {
      h1?: MacdPoint;
      m15?: MacdPoint;
      m5?: MacdPoint;
    };
  };
}

function emaSeriesAligned(values: number[], period: number): (number | null)[] {
  if (values.length === 0 || period < 1) return [];
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  let ema = sum / period;
  result[period - 1] = ema;

  const multiplier = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    ema = values[i] * multiplier + ema * (1 - multiplier);
    result[i] = ema;
  }

  return result;
}

function computeMacdSeries(candles: Candle[]): MacdPoint[] {
  if (candles.length === 0) return [];

  const closes = candles.map((c) => c.close);
  const ema12 = emaSeriesAligned(closes, 12);
  const ema26 = emaSeriesAligned(closes, 26);

  const macdLine: (number | null)[] = ema12.map((e12, i) => {
    const e26 = ema26[i];
    if (e12 === null || e26 === null) return null;
    return e12 - e26;
  });

  const macdValues = macdLine.filter((m) => m !== null) as number[];
  if (macdValues.length < 9) return [];

  const signalEma = emaSeriesAligned(macdValues, 9);
  const signalLine: (number | null)[] = new Array(macdLine.length).fill(null);
  let macdValueIndex = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] !== null) {
      signalLine[i] = signalEma[macdValueIndex];
      macdValueIndex++;
    }
  }

  const histogram: (number | null)[] = macdLine.map((macd, i) => {
    const signal = signalLine[i];
    if (macd === null || signal === null) return null;
    return macd - signal;
  });

  const result: MacdPoint[] = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] !== null && signalLine[i] !== null && histogram[i] !== null) {
      result.push({
        timestamp: candles[i].timestamp,
        macd: macdLine[i] as number,
        signal: signalLine[i] as number,
        histogram: histogram[i] as number,
      });
    }
  }

  return result;
}

function computeMacdStats(
  macdSeries: MacdPoint[],
  lookback: number
): {
  min: number;
  max: number;
  p25: number;
  p50: number;
  p75: number;
} {
  const range = macdSeries.slice(-lookback);
  if (range.length === 0) {
    return { min: 0, max: 0, p25: 0, p50: 0, p75: 0 };
  }

  const values = range.map((pt) => pt.macd).sort((a, b) => a - b);
  const min = values[0];
  const max = values[values.length - 1];

  const p25Index = Math.floor(values.length * 0.25);
  const p50Index = Math.floor(values.length * 0.5);
  const p75Index = Math.floor(values.length * 0.75);

  return {
    min,
    max,
    p25: values[p25Index],
    p50: values[p50Index],
    p75: values[p75Index],
  };
}

function computeH1BiasFromSeries(macdSeries: MacdPoint[]): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  if (macdSeries.length < MIN_H1_MACD_POINTS) {
    return 'NEUTRAL';
  }

  const latestMacd = macdSeries[macdSeries.length - 1];
  if (!latestMacd) {
    return 'NEUTRAL';
  }

  const stats = computeMacdStats(macdSeries, macdSeries.length);
  const macdRange = stats.max - stats.min;

  if (macdRange <= 0) {
    return 'NEUTRAL';
  }

  const minSeparation = macdRange * 0.05;

  if (latestMacd.macd > latestMacd.signal && latestMacd.signal > 0) {
    const separation = latestMacd.macd - latestMacd.signal;
    if (separation > minSeparation) {
      return 'BULLISH';
    }
  }

  if (latestMacd.macd < latestMacd.signal && latestMacd.signal < 0) {
    const separation = latestMacd.signal - latestMacd.macd;
    if (separation > minSeparation) {
      return 'BEARISH';
    }
  }

  return 'NEUTRAL';
}

function findRecentCrossover(
  macdSeries: MacdPoint[],
  lookback: number
): {
  index: number;
  direction: 'LONG' | 'SHORT' | 'NONE';
} {
  if (macdSeries.length < 2) {
    return { index: -1, direction: 'NONE' };
  }

  const start = Math.max(0, macdSeries.length - lookback);
  for (let i = macdSeries.length - 1; i > start; i--) {
    const curr = macdSeries[i];
    const prev = macdSeries[i - 1];

    if (prev.macd <= prev.signal && curr.macd > curr.signal) {
      return { index: i, direction: 'LONG' };
    }

    if (prev.macd >= prev.signal && curr.macd < curr.signal) {
      return { index: i, direction: 'SHORT' };
    }
  }

  return { index: -1, direction: 'NONE' };
}

function computeM15Signal(
  macdSeries: MacdPoint[],
  bias: 'BULLISH' | 'BEARISH'
): {
  direction: 'LONG' | 'SHORT' | 'NONE';
  recentCrossIndex: number;
  strengthOk: boolean;
  strengthReason?: string;
} {
  const crossover = findRecentCrossover(macdSeries, M15_CROSS_LOOKBACK);

  if (crossover.direction === 'NONE') {
    return {
      direction: 'NONE',
      recentCrossIndex: -1,
      strengthOk: false,
      strengthReason: 'NO_CROSSOVER',
    };
  }

  const biasMatch =
    (bias === 'BULLISH' && crossover.direction === 'LONG') ||
    (bias === 'BEARISH' && crossover.direction === 'SHORT');

  if (!biasMatch) {
    return {
      direction: 'NONE',
      recentCrossIndex: crossover.index,
      strengthOk: false,
      strengthReason: 'BIAS_MISMATCH',
    };
  }

  const stats = computeMacdStats(macdSeries, M15_STATS_LOOKBACK);
  const crossoverMacd = macdSeries[crossover.index].macd;

  let strengthOk = false;
  if (crossover.direction === 'LONG' && crossoverMacd >= stats.p75) {
    strengthOk = true;
  } else if (crossover.direction === 'SHORT' && crossoverMacd <= stats.p25) {
    strengthOk = true;
  }

  return {
    direction: crossover.direction,
    recentCrossIndex: crossover.index,
    strengthOk,
    strengthReason: strengthOk ? 'OK' : 'WEAK_STRENGTH',
  };
}

function confirmM5Histogram(macdSeries: MacdPoint[], biasDirection: 'LONG' | 'SHORT'): boolean {
  if (macdSeries.length < 3) {
    return false;
  }

  const h0 = macdSeries[macdSeries.length - 1].histogram;
  const h1 = macdSeries[macdSeries.length - 2].histogram;
  const h2 = macdSeries[macdSeries.length - 3].histogram;

  if (biasDirection === 'LONG') {
    if (!(h0 > 0 && h1 > 0 && h2 > 0)) {
      return false;
    }
    const increases = (h1 > h2 ? 1 : 0) + (h0 > h1 ? 1 : 0);
    return increases >= 1;
  }

  if (biasDirection === 'SHORT') {
    if (!(h0 < 0 && h1 < 0 && h2 < 0)) {
      return false;
    }
    const decreases = (h1 < h0 ? 1 : 0) + (h2 < h1 ? 1 : 0);
    return decreases >= 1;
  }

  return false;
}

export async function computeMacdDecision(
  client: BinanceClient,
  symbol: string
): Promise<MacdDecision> {
  try {
    const [h1Candles, m15Candles, m5Candles] = await Promise.all([
      fetchCandles(client, symbol, '1h', H1_LIMIT),
      fetchCandles(client, symbol, '15m', M15_LIMIT),
      fetchCandles(client, symbol, '5m', M5_LIMIT),
    ]);

    log.info(
      `${symbol}: Fetched H1=${h1Candles.length}, 15m=${m15Candles.length}, 5m=${m5Candles.length} candles`
    );

    // Gate 1: Determine H1 bias
    if (h1Candles.length < 26) {
      log.error(`${symbol}: ❌ INSUFFICIENT DATA - Need 26+ H1 candles, got ${h1Candles.length}`);
      return {
        symbol,
        signal: 'HOLD',
        score: 0,
        meta: {
          currentPrice: 0,
          reason: `Insufficient H1 candles (got ${h1Candles.length}, need 26+)`,
        },
      };
    }

    const h1Macd = computeMacdSeries(h1Candles);
    const h1Bias = computeH1BiasFromSeries(h1Macd);

    const h1Latest = h1Macd[h1Macd.length - 1];
    log.info(
      `${symbol} - Gate 1 (H1 Bias): MACD=${h1Latest?.macd?.toFixed(4) ?? 'null'}, Signal=${h1Latest?.signal?.toFixed(4) ?? 'null'}, Hist=${h1Latest?.histogram?.toFixed(4) ?? 'null'} => Bias: ${h1Bias}`
    );

    if (h1Bias === 'NEUTRAL') {
      log.info(
        `${symbol}: ❌ Gate 1 FAILED - H1 bias is NEUTRAL (need clear BULLISH or BEARISH trend)`
      );
      return {
        symbol,
        signal: 'HOLD',
        score: 0,
        meta: {
          currentPrice: 0,
          reason: 'H1 bias neutral',
          h1Bias: 'NEUTRAL',
        },
      };
    }
    log.info(`${symbol}: ✅ Gate 1 PASSED - H1 bias is ${h1Bias}`);

    // Gate 2: Compute 15m MACD series
    if (m15Candles.length < 26) {
      return {
        symbol,
        signal: 'HOLD',
        score: 0,
        meta: {
          currentPrice: 0,
          reason: 'Insufficient 15m candles',
          h1Bias,
        },
      };
    }

    const m15Macd = computeMacdSeries(m15Candles);
    const m15Signal = computeM15Signal(m15Macd, h1Bias);

    const m15Latest = m15Macd[m15Macd.length - 1];
    const m15CrossPoint =
      m15Signal.recentCrossIndex >= 0 ? m15Macd[m15Signal.recentCrossIndex] : null;
    log.info(
      `${symbol} - Gate 2 (15m Crossover): Latest MACD=${m15Latest?.macd?.toFixed(4) ?? 'null'}, Signal=${m15Latest?.signal?.toFixed(4) ?? 'null'}`
    );
    if (m15CrossPoint) {
      log.info(
        `${symbol} - Gate 2: Crossover found at index ${m15Signal.recentCrossIndex}, Direction=${m15Signal.direction}, Strength=${m15CrossPoint.macd?.toFixed(4)}, StrengthOK=${m15Signal.strengthOk}, Reason=${m15Signal.strengthReason}`
      );
    }

    if (m15Signal.direction === 'NONE' || !m15Signal.strengthOk) {
      const reasonMsg =
        m15Signal.strengthReason === 'NO_CROSSOVER'
          ? 'No 15m crossover found in recent lookback'
          : m15Signal.strengthReason === 'BIAS_MISMATCH'
            ? '15m crossover direction mismatches H1 bias'
            : '15m crossover strength insufficient (below percentile threshold)';
      log.info(`${symbol}: ❌ Gate 2 FAILED - ${reasonMsg}`);
      return {
        symbol,
        signal: 'HOLD',
        score: 0,
        meta: {
          currentPrice: 0,
          reason: `15m trend gate failed: ${reasonMsg}`,
          h1Bias,
          m15CrossoverPrice: m15Macd[m15Signal.recentCrossIndex]?.macd,
          m15CrossoverStrength: m15Signal.strengthReason,
        },
      };
    }
    log.info(
      `${symbol}: ✅ Gate 2 PASSED - 15m crossover direction=${m15Signal.direction}, strength OK`
    );

    // Gate 3: Compute 5m MACD series
    if (m5Candles.length < 26) {
      return {
        symbol,
        signal: 'HOLD',
        score: 0,
        meta: {
          currentPrice: 0,
          reason: 'Insufficient 5m candles',
          h1Bias,
          m15CrossoverPrice: m15Macd[m15Signal.recentCrossIndex]?.macd,
        },
      };
    }

    const m5Macd = computeMacdSeries(m5Candles);
    const m5Confirm = confirmM5Histogram(m5Macd, m15Signal.direction);

    const m5Latest = m5Macd[m5Macd.length - 1];
    const m5Prev1 = m5Macd[m5Macd.length - 2];
    const m5Prev2 = m5Macd[m5Macd.length - 3];
    log.info(
      `${symbol} - Gate 3 (5m Histogram): [-2]=${m5Prev2?.histogram?.toFixed(4) ?? 'null'}, [-1]=${m5Prev1?.histogram?.toFixed(4) ?? 'null'}, [0]=${m5Latest?.histogram?.toFixed(4) ?? 'null'}`
    );
    log.info(`${symbol} - Gate 3: Direction=${m15Signal.direction}, Confirmation=${m5Confirm}`);

    if (!m5Confirm) {
      log.info(
        `${symbol}: ❌ Gate 3 FAILED - 5m histogram not expanding in ${m15Signal.direction} direction (need 2 of 3 bars expanding)`
      );
      return {
        symbol,
        signal: 'HOLD',
        score: 0,
        meta: {
          currentPrice: m5Candles[m5Candles.length - 1]?.close ?? 0,
          reason: '5m histogram not confirming',
          h1Bias,
          m15CrossoverPrice: m15Macd[m15Signal.recentCrossIndex]?.macd,
          m5HistogramConfirm: false,
        },
      };
    }
    log.info(`${symbol}: ✅ Gate 3 PASSED - 5m histogram confirming ${m15Signal.direction}`);

    const currentPrice = m5Candles[m5Candles.length - 1]?.close ?? 0;
    const score = 3;

    log.info(
      `${symbol}: 🎯 ALL 3 GATES PASSED! Signal=${m15Signal.direction === 'LONG' ? 'BUY' : 'SELL'}, Price=${currentPrice.toFixed(2)}`
    );

    return {
      symbol,
      signal: m15Signal.direction === 'LONG' ? 'BUY' : 'SELL',
      score,
      meta: {
        currentPrice,
        reason: 'All MACD gates passed (H1 bias + 15m crossover + 5m confirmation)',
        h1Bias,
        m15CrossoverPrice: m15Macd[m15Signal.recentCrossIndex]?.macd,
        m15CrossoverStrength: m15Signal.strengthReason ?? 'OK',
        m5HistogramConfirm: true,
        macdDebug: {
          h1: h1Macd[h1Macd.length - 1],
          m15: m15Macd[m15Macd.length - 1],
          m5: m5Macd[m5Macd.length - 1],
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
