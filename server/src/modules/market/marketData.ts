import type { BinanceClient } from '../exchange/binanceClient.js';
import type { BinanceKline } from '../exchange/types.js';
import { createLogger } from '../../services/logger.js';
import { insertCandles, type CandleInsert } from '../db/queries/candles.js';

const log = createLogger('market');

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export interface SymbolCandles {
  symbol: string;
  candles: Candle[];
  lastUpdate: number;
}

/**
 * Fetches klines (candles) for a single symbol and stores them in DB.
 */
export async function fetchCandles(
  client: BinanceClient,
  symbol: string,
  interval: string = '1m',
  limit: number = 100
): Promise<Candle[]> {
  const klines = await client.getKlines(symbol, interval, limit);
  if (klines.length === 0) {
    log.warn(`⚠️  ${symbol}: Klines response is empty`);
    return [];
  }

  const candles = klines.map((k: BinanceKline) => {
    try {
      const candle = {
        openTime: k.openTime,
        open: parseFloat(k.open),
        high: parseFloat(k.high),
        low: parseFloat(k.low),
        close: parseFloat(k.close),
        volume: parseFloat(k.volume),
        closeTime: k.closeTime,
      };

      // Check for NaN values
      if (
        isNaN(candle.open) ||
        isNaN(candle.high) ||
        isNaN(candle.low) ||
        isNaN(candle.close) ||
        isNaN(candle.volume)
      ) {
        log.error(
          `${symbol}: Invalid candle data - open=${k.open}, high=${k.high}, low=${k.low}, close=${k.close}, volume=${k.volume}`
        );
        return null;
      }

      return candle;
    } catch (error) {
      log.error(`${symbol}: Error parsing candle:`, error);
      return null;
    }
  });

  // Filter out null values
  const validCandles = candles.filter((c) => c !== null) as Candle[];

  // Store candles in database (async, don't block)
  if (validCandles.length > 0) {
    const candleInserts: CandleInsert[] = validCandles.map((c) => ({
      symbol,
      interval,
      open_time: c.openTime,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      close_time: c.closeTime,
    }));

    insertCandles(candleInserts).catch((err) => {
      log.error(`Failed to store candles for ${symbol}:`, err);
    });
  }

  return validCandles;
}

/**
 * Fetches candles for multiple symbols in parallel.
 */
export async function fetchMultiSymbolCandles(
  client: BinanceClient,
  symbols: string[],
  interval: string = '1m',
  limit: number = 100
): Promise<SymbolCandles[]> {
  const now = Date.now();
  log.info(`Fetching candles for ${symbols.length} symbols: ${symbols.join(', ')}`);

  const results = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const candles = await fetchCandles(client, symbol, interval, limit);
      if (candles.length === 0) {
        log.warn(`⚠️  ${symbol}: No candles fetched (empty response from API)`);
      }
      return { symbol, candles, lastUpdate: now };
    })
  );

  const successful: SymbolCandles[] = [];
  const failed: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result?.status === 'fulfilled' && result.value) {
      successful.push(result.value);
    } else if (result?.status === 'rejected') {
      const symbol = symbols[i];
      failed.push(symbol);
      const errorMsg =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      if (errorMsg.includes('Invalid symbol')) {
        log.warn(`⚠️  Symbol ${symbol} is invalid (not available on this exchange)`);
      } else {
        log.error(`Failed to fetch candles for ${symbol}:`, result.reason);
      }
    }
  }

  if (failed.length > 0) {
    log.warn(`Failed symbols: ${failed.join(', ')} - consider adding to EXCLUDE_SYMBOLS`);
  }

  log.info(`Successfully fetched candles for ${successful.length}/${symbols.length} symbols`);
  return successful;
}

/**
 * Computes Simple Moving Average (SMA) for a given period.
 */
export function computeSMA(candles: Candle[], period: number): number | null {
  if (candles.length < period) {
    return null;
  }
  const sum = candles.slice(-period).reduce((acc, c) => acc + c.close, 0);
  return sum / period;
}

/**
 * Computes Exponential Moving Average (EMA) for a given period.
 */
export function computeEMA(candles: Candle[], period: number): number | null {
  if (candles.length < period) {
    return null;
  }

  const k = 2 / (period + 1);
  let ema = candles[0]?.close ?? 0;

  for (let i = 1; i < candles.length; i++) {
    const close = candles[i]?.close ?? 0;
    ema = close * k + ema * (1 - k);
  }

  return ema;
}

/**
 * Computes RSI (Relative Strength Index) for a given period.
 */
export function computeRSI(candles: Candle[], period: number = 14): number | null {
  if (candles.length < period + 1) {
    return null;
  }

  const changes = [];
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i]?.close ?? 0;
    const prev = candles[i - 1]?.close ?? 0;
    changes.push(curr - prev);
  }

  let gains = 0;
  let losses = 0;

  for (let i = 0; i < period; i++) {
    const change = changes[i] ?? 0;
    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period; i < changes.length; i++) {
    const change = changes[i] ?? 0;
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
  }

  if (avgLoss === 0) {
    return 100;
  }

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Computes Commodity Channel Index (CCI) for a given period.
 * CCI = (TP - SMA(TP)) / (0.015 * MeanDeviation)
 */
export function computeCCI(candles: Candle[], period: number = 20): number | null {
  if (candles.length < period) {
    return null;
  }

  const recent = candles.slice(-period);
  const typicalPrices = recent.map((c) => (c.high + c.low + c.close) / 3);
  const smaTp = typicalPrices.reduce((acc, tp) => acc + tp, 0) / period;

  const meanDeviation = typicalPrices.reduce((acc, tp) => acc + Math.abs(tp - smaTp), 0) / period;

  if (meanDeviation === 0) {
    return 0;
  }

  const latestTp = typicalPrices[typicalPrices.length - 1] ?? smaTp;
  return (latestTp - smaTp) / (0.015 * meanDeviation);
}
