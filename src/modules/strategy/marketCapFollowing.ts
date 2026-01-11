/**
 * Market Cap Following Algorithm
 *
 * Strategy: Follow market cap trends and volume momentum
 * Signals based on:
 * - Volume increase (market interest)
 * - Price momentum (SMA/EMA crossovers)
 * - Volatility (RSI, ATR)
 * - Market cap correlation between assets
 */

import type { Candle } from '../market/marketData.js';
import { computeSMA, computeEMA, computeRSI } from '../market/marketData.js';
import { createLogger } from '../../services/logger.js';

const log = createLogger('strategy/marketcap');

export interface MarketCapSignal {
  symbol: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  score: number;
  confidence: number; // 0-100
  meta: {
    currentPrice: number;
    volumeTrend: number; // -100 to +100
    momentumScore: number;
    volatility: number;
    reason: string;
  };
}

/**
 * Calculates volume trend (increase/decrease)
 */
function calculateVolumeTrend(candles: Candle[], period: number = 20): number {
  if (candles.length < period) return 0;

  const recentVolume = candles.slice(-period).reduce((a, c) => a + c.volume, 0) / period;
  const previousVolume =
    candles.slice(-period * 2, -period).reduce((a, c) => a + c.volume, 0) / period;

  if (previousVolume === 0) return 0;
  return ((recentVolume - previousVolume) / previousVolume) * 100;
}

/**
 * Calculates Average True Range (ATR) for volatility
 */
function calculateATR(candles: Candle[], period: number = 14): number {
  if (candles.length < period) return 0;

  const trueRanges = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });

  const atr = trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
  return atr;
}

/**
 * Market Cap Following Signal
 *
 * Focuses on:
 * 1. Volume surge (market cap following = volume increase)
 * 2. Price momentum (trend strength)
 * 3. Volatility expansion (breakout potential)
 * 4. RSI confirmation (momentum confirmation)
 */
export function computeMarketCapSignal(candles: Candle[], symbol: string): MarketCapSignal {
  if (candles.length < 50) {
    return {
      symbol,
      signal: 'HOLD',
      score: 0,
      confidence: 0,
      meta: {
        currentPrice: candles[candles.length - 1]?.close ?? 0,
        volumeTrend: 0,
        momentumScore: 0,
        volatility: 0,
        reason: 'Insufficient data',
      },
    };
  }

  const currentPrice = candles[candles.length - 1].close;
  const sma20 = computeSMA(candles, 20);
  const sma50 = computeSMA(candles, 50);
  const ema12 = computeEMA(candles, 12);
  const ema26 = computeEMA(candles, 26);
  const rsi = computeRSI(candles, 14);
  const volumeTrend = calculateVolumeTrend(candles, 20);
  const atr = calculateATR(candles, 14);
  const volatility = atr / currentPrice; // ATR as percentage of price

  let score = 0;
  let confidence = 50;
  const reasons: string[] = [];

  // 1. VOLUME SURGE - Primary signal for market cap following
  if (volumeTrend > 50) {
    score += 4;
    confidence += 20;
    reasons.push(`Volume surge: ${volumeTrend.toFixed(1)}%`);
  } else if (volumeTrend > 20) {
    score += 2;
    confidence += 10;
    reasons.push(`Volume increase: ${volumeTrend.toFixed(1)}%`);
  } else if (volumeTrend < -40) {
    score -= 3;
    confidence += 10;
    reasons.push(`Volume collapse: ${volumeTrend.toFixed(1)}%`);
  }

  // 2. MOMENTUM - Price trend confirmation
  if (sma20 !== null && sma50 !== null) {
    const trendStrength = ((sma20 - sma50) / sma50) * 100;
    if (trendStrength > 2) {
      score += 3;
      confidence += 15;
      reasons.push(`Strong uptrend: ${trendStrength.toFixed(2)}%`);
    } else if (trendStrength > 0.5) {
      score += 1;
      reasons.push(`Weak uptrend: ${trendStrength.toFixed(2)}%`);
    } else if (trendStrength < -2) {
      score -= 3;
      reasons.push(`Strong downtrend: ${trendStrength.toFixed(2)}%`);
    }
  }

  // 3. EMA CROSSOVER - Momentum confirmation
  if (ema12 !== null && ema26 !== null) {
    if (ema12 > ema26) {
      score += 2;
      confidence += 10;
      reasons.push('EMA12 > EMA26 (bullish momentum)');
    } else {
      score -= 2;
    }
  }

  // 4. VOLATILITY EXPANSION - Breakout signal
  if (volatility > 0.02) {
    // ATR > 2% of price
    score += 2;
    confidence += 10;
    reasons.push(`Volatility expansion: ${(volatility * 100).toFixed(2)}%`);
  }

  // 5. RSI CONFIRMATION
  if (rsi !== null) {
    if (rsi < 40) {
      score += 1;
      reasons.push(`RSI: ${rsi.toFixed(1)} (oversold)`);
    } else if (rsi > 60) {
      score -= 1;
      reasons.push(`RSI: ${rsi.toFixed(1)} (overbought)`);
    }
  }

  // Determine signal
  let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  if (score >= 5) {
    signal = 'BUY';
  } else if (score <= -4) {
    signal = 'SELL';
  }

  confidence = Math.min(100, Math.max(0, confidence));

  log.debug(
    `${symbol}: signal=${signal}, score=${score}, confidence=${confidence.toFixed(0)}%, volumeTrend=${volumeTrend.toFixed(1)}%`
  );

  return {
    symbol,
    signal,
    score,
    confidence,
    meta: {
      currentPrice,
      volumeTrend,
      momentumScore: sma20 && sma50 ? ((sma20 - sma50) / sma50) * 100 : 0,
      volatility: volatility * 100,
      reason: reasons.join(' | ') || 'No clear signal',
    },
  };
}

/**
 * Multi-symbol market cap following signals
 */
export function computeMarketCapSignals(
  candles: { symbol: string; candles: Candle[] }[]
): MarketCapSignal[] {
  return candles.map((data) => computeMarketCapSignal(data.candles, data.symbol));
}
