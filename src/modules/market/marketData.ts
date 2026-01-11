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
  return klines.map((k: BinanceKline) => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    closeTime: k[6],
  }));
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
      return { symbol, candles, lastUpdate: now };
    })
  );

  const successful: SymbolCandles[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      successful.push(result.value);
    } else {
      log.error('Failed to fetch candles:', result.reason);
    }
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
  let ema = candles[0].close;

  for (let i = 1; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
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
    changes.push(candles[i].close - candles[i - 1].close);
  }

  let gains = 0;
  let losses = 0;

  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) {
      gains += changes[i];
    } else {
      losses += Math.abs(changes[i]);
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
  }

  if (avgLoss === 0) {
    return 100;
  }

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
