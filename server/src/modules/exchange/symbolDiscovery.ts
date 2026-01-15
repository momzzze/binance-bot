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

/**
 * Filters symbols by recent price trend (last 24h performance)
 * Only keeps symbols that are:
 * - UP in last 24h (positive priceChangePercent)
 * - NOT on a 2+ day downtrend
 */
function filterByTrend(
  tickers: BinanceTicker24h[],
  minGainPercent: number = 0.1
): BinanceTicker24h[] {
  return tickers.filter((t) => {
    const priceChange = Number(t.priceChangePercent);

    // Only keep symbols with positive 24h trend
    if (priceChange < minGainPercent) {
      return false;
    }

    // High Volume moving up is a good sign
    const volChange = Number(t.quoteVolume);
    return Number.isFinite(volChange) && volChange > 0;
  });
}

function selectTopByVolume(
  tickers: BinanceTicker24h[],
  minQuoteVolume: number,
  topN: number,
  exclude: string[],
  filterTrend: boolean = true
): string[] {
  const excludeSet = new Set(normalizeSymbols(exclude));

  let filtered = tickers
    .filter((t) => t.symbol.endsWith('USDC'))
    .filter((t) => {
      const vol = Number(t.quoteVolume);
      return Number.isFinite(vol) && vol >= minQuoteVolume;
    })
    .filter((t) => !excludeSet.has(t.symbol));

  // Filter by uptrend if enabled
  if (filterTrend) {
    const beforeTrend = filtered.length;
    filtered = filterByTrend(filtered, 0.1); // Minimum 0.1% gain in 24h

    const filtered_out = beforeTrend - filtered.length;
    if (filtered_out > 0) {
      log.info(`📊 Filtered out ${filtered_out} symbols with downtrends or no gain`);
    }
  }

  return filtered
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, topN)
    .map((t) => {
      const change = Number(t.priceChangePercent);
      log.debug(`  ✅ ${t.symbol}: +${change.toFixed(2)}% (24h trend)`);
      return t.symbol.toUpperCase();
    });
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

  log.info('🔍 Discovering symbols with good uptrends...');
  const tickers = await client.getAll24hTickers();

  const autoSymbols = selectTopByVolume(
    tickers,
    config.MIN_QUOTE_VOLUME_USDT,
    config.AUTO_TOP_N,
    config.EXCLUDE_SYMBOLS,
    true // Enable trend filtering
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
