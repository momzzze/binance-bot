import type { Candle, SymbolCandles } from '../market/marketData.js';
import { computeSMA, computeEMA, computeRSI } from '../market/marketData.js';
import { createLogger } from '../../services/logger.js';

const log = createLogger('strategy');

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
 *
 * BUY signals:
 * - SMA20 > SMA50 (bullish trend)
 * - EMA12 > EMA26 (short-term momentum)
 * - RSI < 70 (not overbought)
 *
 * SELL signals:
 * - SMA20 < SMA50 (bearish trend)
 * - EMA12 < EMA26 (short-term weakness)
 * - RSI > 30 (not oversold)
 *
 * HOLD otherwise.
 */
export function computeSignal(symbolCandles: SymbolCandles): Decision {
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

  if (candles.length < 50) {
    return {
      symbol,
      signal: 'HOLD',
      score: 0,
      meta: {
        currentPrice: candles[candles.length - 1]?.close ?? 0,
        reason: 'Insufficient candles for analysis',
      },
    };
  }

  const currentPrice = candles[candles.length - 1].close;
  const sma20 = computeSMA(candles, 20);
  const sma50 = computeSMA(candles, 50);
  const ema12 = computeEMA(candles, 12);
  const ema26 = computeEMA(candles, 26);
  const rsi = computeRSI(candles, 14);

  const meta = {
    currentPrice,
    sma20: sma20 ?? undefined,
    sma50: sma50 ?? undefined,
    ema12: ema12 ?? undefined,
    ema26: ema26 ?? undefined,
    rsi: rsi ?? undefined,
    reason: '',
  };

  // Calculate score based on conditions
  let score = 0;
  const reasons: string[] = [];

  log.debug(
    `${symbol}: Evaluating - price=${currentPrice.toFixed(2)}, SMA20=${sma20?.toFixed(2)}, SMA50=${sma50?.toFixed(2)}, EMA12=${ema12?.toFixed(2)}, EMA26=${ema26?.toFixed(2)}, RSI=${rsi?.toFixed(1)}`
  );

  // SMA trend
  if (sma20 !== null && sma50 !== null) {
    if (sma20 > sma50) {
      score += 3;
      reasons.push('SMA20>SMA50');
      log.debug(`  +3 SMA trend: 20(${sma20.toFixed(2)}) > 50(${sma50.toFixed(2)})`);
    } else if (sma20 < sma50) {
      score -= 3;
      reasons.push('SMA20<SMA50');
      log.debug(`  -3 SMA trend: 20(${sma20.toFixed(2)}) < 50(${sma50.toFixed(2)})`);
    }
  }

  // EMA momentum
  if (ema12 !== null && ema26 !== null) {
    if (ema12 > ema26) {
      score += 2;
      reasons.push('EMA12>EMA26');
      log.debug(`  +2 EMA momentum: 12(${ema12.toFixed(2)}) > 26(${ema26.toFixed(2)})`);
    } else if (ema12 < ema26) {
      score -= 2;
      reasons.push('EMA12<EMA26');
      log.debug(`  -2 EMA momentum: 12(${ema12.toFixed(2)}) < 26(${ema26.toFixed(2)})`);
    }
  }

  // RSI conditions
  if (rsi !== null) {
    if (rsi < 30) {
      score += 2;
      reasons.push('RSI<30 (oversold)');
      log.debug(`  +2 RSI oversold: ${rsi.toFixed(1)} < 30`);
    } else if (rsi > 70) {
      score -= 2;
      reasons.push('RSI>70 (overbought)');
      log.debug(`  -2 RSI overbought: ${rsi.toFixed(1)} > 70`);
    } else if (rsi < 50) {
      score += 1;
      reasons.push('RSI<50');
      log.debug(`  +1 RSI mild oversold: ${rsi.toFixed(1)} < 50`);
    } else {
      score -= 1;
      reasons.push('RSI>50');
      log.debug(`  -1 RSI mild overbought: ${rsi.toFixed(1)} > 50`);
    }
  }

  meta.reason = reasons.join(', ') || 'No clear signal';

  // Determine signal based on score
  let signal: Signal = 'HOLD';
  if (score >= 2) {
    signal = 'BUY';
  } else if (score <= -2) {
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
export function computeMultiSymbolSignals(symbolCandlesArray: SymbolCandles[]): Decision[] {
  return symbolCandlesArray.map(computeSignal);
}
