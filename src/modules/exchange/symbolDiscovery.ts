import { createLogger } from '../../services/logger.js';
import type { BotConfig } from '../../config/env.js';
import type { BinanceClient } from './binanceClient.js';
import type { BinanceTicker24h } from './types.js';

const log = createLogger('symbolDiscovery');

interface SymbolCache {
  symbols: string[];
  source: 'manual' | 'auto';
  lastFetched: number;
}

const cache: SymbolCache = {
  symbols: [],
  source: 'manual',
  lastFetched: 0,
};

function normalizeSymbols(list: string[]): string[] {
  return Array.from(new Set(list.map((s) => s.trim().toUpperCase()).filter(Boolean)));
}

function applyExclusions(symbols: string[], exclude: string[]): string[] {
  const excludeSet = new Set(normalizeSymbols(exclude));
  return symbols.filter((s) => !excludeSet.has(s));
}

function pickManualSymbols(config: BotConfig): string[] {
  const manual = normalizeSymbols(
    config.MANUAL_SYMBOLS.length > 0 ? config.MANUAL_SYMBOLS : config.SYMBOLS
  );
  return applyExclusions(manual, config.EXCLUDE_SYMBOLS);
}

function selectTopByVolume(
  tickers: BinanceTicker24h[],
  minQuoteVolume: number,
  topN: number,
  exclude: string[]
): string[] {
  const excludeSet = new Set(normalizeSymbols(exclude));

  return tickers
    .filter((t) => t.symbol.endsWith('USDT'))
    .filter((t) => {
      const vol = Number(t.quoteVolume);
      return Number.isFinite(vol) && vol >= minQuoteVolume;
    })
    .filter((t) => !excludeSet.has(t.symbol))
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, topN)
    .map((t) => t.symbol.toUpperCase());
}

async function computeSymbols(client: BinanceClient, config: BotConfig): Promise<SymbolCache> {
  const manualSymbols = pickManualSymbols(config);

  if (!config.AUTO_SYMBOLS) {
    return {
      symbols: manualSymbols,
      source: 'manual',
      lastFetched: Date.now(),
    };
  }

  const tickers = await client.getAll24hTickers();
  const autoSymbols = selectTopByVolume(
    tickers,
    config.MIN_QUOTE_VOLUME_USDT,
    config.AUTO_TOP_N,
    config.EXCLUDE_SYMBOLS
  );

  const merged = normalizeSymbols([...manualSymbols, ...autoSymbols]);
  const symbols = applyExclusions(merged, config.EXCLUDE_SYMBOLS);

  return {
    symbols,
    source: 'auto',
    lastFetched: Date.now(),
  };
}

export async function getTradeSymbols(
  client: BinanceClient,
  config: BotConfig
): Promise<{ symbols: string[]; source: 'manual' | 'auto'; lastFetched: number }> {
  const now = Date.now();
  const refreshMs = config.SYMBOL_REFRESH_MINUTES * 60 * 1000;

  if (cache.symbols.length > 0 && now - cache.lastFetched < refreshMs) {
    return cache;
  }

  const next = await computeSymbols(client, config);

  cache.symbols = next.symbols;
  cache.source = next.source;
  cache.lastFetched = next.lastFetched;

  const reason = next.source === 'auto' ? 'auto-discovered' : 'manual';
  log.info(`Using ${next.symbols.length} symbols (${reason}): ${next.symbols.join(', ')}`);

  return cache;
}

export function getCachedSymbols(): string[] {
  return cache.symbols;
}
