import type { BinanceClient } from '../exchange/binanceClient.js';
import type { BinanceKline } from '../exchange/types.js';
import { createLogger } from '../../services/logger.js';

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
 * Fetches klines (candles) for a single symbol.
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
  return candles.filter((c) => c !== null) as Candle[];
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
