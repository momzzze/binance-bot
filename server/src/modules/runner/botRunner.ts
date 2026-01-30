import type { BinanceClient } from '../exchange/binanceClient.js';
import type { BotConfig } from '../../config/env.js';
import { fetchMultiSymbolCandles } from '../market/marketData.js';
import { computeMultiSymbolSignals as computeSimpleSignals } from '../strategy/simpleStrategy.js';
import { computeMarketCapSignals } from '../strategy/marketCapFollowing.js';
import { computeMultiSymbolSignals as computeMacdSignals } from '../strategy/macdStrategy.js';
import { executeDecisions } from '../execution/executor.js';
import { monitorPositions } from '../execution/positionMonitor.js';
import { checkGlobalTrading } from '../risk/riskEngine.js';
import { createLogger } from '../../services/logger.js';
import { sleep } from '../../utils/sleep.js';
import { getTradeSymbols } from '../exchange/symbolDiscovery.js';

const log = createLogger('runner');

let isRunning = false;
let shouldStop = false;
let currentSymbols: string[] = [];
let symbolSource: 'manual' | 'auto' = 'manual';

/**
 * Main bot loop that:
 * 1. Fetches candles for all symbols
 * 2. Computes trading signals
 * 3. Executes orders based on signals
 * 4. Sleeps and repeats
 */
export async function runBot(client: BinanceClient, config: BotConfig): Promise<void> {
  if (isRunning) {
    log.warn('Bot is already running');
    return;
  }

  isRunning = true;
  shouldStop = false;
  const initialSymbols = await getTradeSymbols(client, config);
  currentSymbols = initialSymbols.symbols;
  symbolSource = initialSymbols.source;

  log.info(`🤖 Bot started - watching ${currentSymbols.length} symbols`);
  log.info(`Symbol source: ${symbolSource}`);
  log.info(`Symbols: ${currentSymbols.join(', ')}`);
  log.info(`Loop interval: ${config.LOOP_MS}ms`);
  log.info(`Strategy: ${config.STRATEGY}`);

  let iteration = 0;

  while (!shouldStop) {
    iteration++;
    const loopStart = Date.now();

    try {
      log.info(`\n━━━ Iteration ${iteration} ━━━`);

      // Get account balance
      try {
        const accountInfo = await client.getAccountInfo();
        const baseAsset = config.BASE_ASSET || 'USDC';
        const baseBalance = accountInfo.balances.find((b) => b.asset === baseAsset);
        const btcBalance = accountInfo.balances.find((b) => b.asset === 'BTC');
        const bnbBalance = accountInfo.balances.find((b) => b.asset === 'BNB');
        log.info(
          `💰 Balance: ${baseBalance ? `${Number(baseBalance.free).toFixed(2)} ${baseAsset}` : `0 ${baseAsset}`}${btcBalance ? ` | ${Number(btcBalance.free).toFixed(6)} BTC` : ''}${bnbBalance ? ` | ${Number(bnbBalance.free).toFixed(4)} BNB` : ''}`
        );
      } catch (error) {
        log.debug('Failed to fetch account balance:', error);
      }

      // Check if trading is globally enabled
      const tradingCheck = await checkGlobalTrading();
      if (!tradingCheck.allowed) {
        log.warn(`Trading disabled: ${tradingCheck.reason}`);
        await sleep(config.LOOP_MS);
        continue;
      }

      const symbolSelection = await getTradeSymbols(client, config);
      currentSymbols = symbolSelection.symbols;
      symbolSource = symbolSelection.source;

      // Monitor open positions for stop loss / take profit
      // IMPORTANT: Always monitor positions even if trading is disabled
      // to ensure stop-losses and take-profits are triggered
      await monitorPositions(client, config);

      // 1. Fetch market data (only needed for candle-based strategies)
      let symbolCandles = [] as Awaited<ReturnType<typeof fetchMultiSymbolCandles>>;
      if (config.STRATEGY !== 'macd') {
        symbolCandles = await fetchMultiSymbolCandles(client, currentSymbols, config.INTERVAL, 100);

        if (symbolCandles.length === 0) {
          log.warn('No candle data fetched - skipping iteration');
          await sleep(config.LOOP_MS);
          continue;
        }
      }

      // 2. Compute signals based on selected strategy
      log.info(`🧠 Computing signals (${config.STRATEGY} strategy)...`);
      let decisions;

      if (config.STRATEGY === 'marketcap') {
        decisions = computeMarketCapSignals(
          symbolCandles.map((sc) => ({
            symbol: sc.symbol,
            candles: sc.candles,
          }))
        ).map((signal) => ({
          symbol: signal.symbol,
          signal: signal.signal,
          score: signal.score,
          meta: signal.meta,
        }));
      } else if (config.STRATEGY === 'macd') {
        decisions = await computeMacdSignals(client, currentSymbols);
      } else {
        // Simple strategy (default) - now async!
        decisions = await computeSimpleSignals(symbolCandles);
      }

      const buySignals = decisions.filter((d) => d.signal === 'BUY');
      const sellSignals = decisions.filter((d) => d.signal === 'SELL');
      const holdSignals = decisions.filter((d) => d.signal === 'HOLD');

      log.info(
        `Signals: ${buySignals.length} BUY, ${sellSignals.length} SELL, ${holdSignals.length} HOLD`
      );

      // Log BUY/SELL decisions
      for (const decision of decisions) {
        if (decision.signal !== 'HOLD') {
          log.info(
            `${decision.symbol}: ${decision.signal} (score=${decision.score}, price=${decision.meta.currentPrice.toFixed(2)})`
          );
          log.debug(`  Reason: ${decision.meta.reason}`);
        }
      }

      // 3. Execute orders
      if (buySignals.length > 0 || sellSignals.length > 0) {
        log.info('💰 Executing orders...');
        const results = await executeDecisions(client, decisions, config);

        const successful = results.filter((r) => r.success);
        const failed = results.filter((r) => !r.success);

        if (successful.length > 0) {
          log.info(`✓ ${successful.length} orders placed successfully`);
        }
        if (failed.length > 0) {
          log.warn(`✗ ${failed.length} orders failed`);
        }
      }

      // 4. Sleep until next iteration
      const loopDuration = Date.now() - loopStart;
      const sleepTime = Math.max(0, config.LOOP_MS - loopDuration);

      if (loopDuration > config.LOOP_MS) {
        log.warn(`Loop took ${loopDuration}ms (longer than ${config.LOOP_MS}ms interval)`);
      }
      await sleep(sleepTime);
    } catch (error) {
      log.error('Error in bot loop:', error);
      await sleep(config.LOOP_MS);
    }
  }

  isRunning = false;
  log.info('🛑 Bot stopped');
}

/**
 * Stops the bot loop gracefully.
 */
export function stopBot(): void {
  if (!isRunning) {
    log.warn('Bot is not running');
    return;
  }

  log.info('Stopping bot...');
  shouldStop = true;
}

/**
 * Returns whether the bot is currently running.
 */
export function isBotRunning(): boolean {
  return isRunning;
}

export function getCurrentSymbols(): string[] {
  if (currentSymbols.length > 0) return currentSymbols;
  return [];
}

export function getSymbolSource(): 'manual' | 'auto' {
  return symbolSource;
}
