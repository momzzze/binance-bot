import type { BinanceClient } from '../exchange/binanceClient.js';
import type { BotConfig } from '../../config/env.js';
import {
  getOpenPositions,
  updatePositionPrice,
  updatePositionStopLoss,
  closePosition,
  type PositionRow,
} from '../db/queries/positions.js';
import { insertOrder } from '../db/queries/orders.js';
import { getActiveStrategyConfig } from '../db/queries/strategy_config.js';
import { addSymbolCooldown } from '../risk/symbolCooldown.js';
import { createLogger } from '../../services/logger.js';

const log = createLogger('positionMonitor');

// Cache for exchange filters to enforce precision/minNotional on exits
const symbolFiltersCache = new Map<
  string,
  { minQty: number; stepSize: number; minNotional: number }
>();

async function getSymbolFilters(client: BinanceClient, symbol: string) {
  if (symbolFiltersCache.has(symbol)) {
    return symbolFiltersCache.get(symbol)!;
  }

  const exchangeInfo = await client.getExchangeInfo(symbol);
  const symbolInfo = exchangeInfo.symbols.find((s) => s.symbol === symbol);
  if (!symbolInfo) {
    throw new Error(`Symbol ${symbol} not found in exchange info`);
  }

  const lotSizeFilter = symbolInfo.filters.find((f) => f.filterType === 'LOT_SIZE');
  const notionalFilter = symbolInfo.filters.find(
    (f) => f.filterType === 'NOTIONAL' || f.filterType === 'MIN_NOTIONAL'
  );

  if (!lotSizeFilter || !lotSizeFilter.minQty || !lotSizeFilter.stepSize) {
    throw new Error(`LOT_SIZE filter not found for ${symbol}`);
  }

  const filters = {
    minQty: parseFloat(lotSizeFilter.minQty),
    stepSize: parseFloat(lotSizeFilter.stepSize),
    minNotional: notionalFilter?.minNotional ? parseFloat(notionalFilter.minNotional) : 10,
  };

  symbolFiltersCache.set(symbol, filters);
  return filters;
}

function roundToStepSize(quantity: number, stepSize: number): number {
  const steps = Math.floor(quantity / stepSize);
  return steps * stepSize;
}

/**
 * Checks all open positions and executes stop loss or take profit if triggered
 */
export async function monitorPositions(client: BinanceClient, config: BotConfig): Promise<void> {
  const openPositions = await getOpenPositions();

  // Pull live strategy config so FE settings apply without restart
  const strategy = await getActiveStrategyConfig();
  const trailingEnabled = strategy ? strategy.trailing_stop_enabled : config.TRAILING_STOP_ENABLED;
  const trailingActivation = strategy
    ? Number(strategy.trailing_stop_activation_percent)
    : config.TRAILING_STOP_ACTIVATION_PERCENT;
  const trailingDistance = strategy
    ? Number(strategy.trailing_stop_distance_percent)
    : config.TRAILING_STOP_DISTANCE_PERCENT;

  if (openPositions.length === 0) {
    return;
  }

  log.info(`Monitoring ${openPositions.length} open positions...`);

  for (const position of openPositions) {
    try {
      await checkPosition(client, position, config, {
        trailingEnabled,
        trailingActivation,
        trailingDistance,
      });
    } catch (error) {
      log.error(`Error checking position ${position.id} (${position.symbol}):`, error);
    }
  }
}

/**
 * Checks a single position for stop loss, take profit, and trailing stop
 */
async function checkPosition(
  client: BinanceClient,
  position: PositionRow,
  config: BotConfig,
  trailing: { trailingEnabled: boolean; trailingActivation: number; trailingDistance: number }
): Promise<void> {
  const { symbol } = position;

  // Get current price
  const ticker = await client.get24hTicker(symbol);
  const currentPrice = Number(ticker.lastPrice);

  // Update position with current price
  await updatePositionPrice(position.id, currentPrice, currentPrice);

  // Calculate PnL
  const pnlPercent = ((currentPrice - position.entry_price) / position.entry_price) * 100;
  const pnlUsdt = (currentPrice - position.entry_price) * position.quantity;

  log.debug(
    `${symbol}: Entry=${position.entry_price.toFixed(2)}, Current=${currentPrice.toFixed(2)}, ` +
      `PnL=${pnlPercent.toFixed(2)}% (${pnlUsdt.toFixed(2)} USDT)`
  );

  // Check STOP LOSS
  if (position.stop_loss_price && currentPrice <= position.stop_loss_price) {
    log.warn(
      `🛑 STOP LOSS HIT for ${symbol}! Price ${currentPrice.toFixed(2)} <= SL ${position.stop_loss_price.toFixed(2)}`
    );
    await executeSellOrder(client, position, 'STOPPED_OUT');
    return;
  }

  // Check TAKE PROFIT
  if (position.take_profit_price && currentPrice >= position.take_profit_price) {
    log.info(
      `🎯 TAKE PROFIT HIT for ${symbol}! Price ${currentPrice.toFixed(2)} >= TP ${position.take_profit_price.toFixed(2)}`
    );
    await executeSellOrder(client, position, 'TAKE_PROFIT');
    return;
  }

  // Check TRAILING STOP
  if (position.trailing_stop_enabled && trailing.trailingEnabled) {
    await checkTrailingStop(
      position,
      currentPrice,
      trailing.trailingActivation,
      trailing.trailingDistance
    );
  }
}

/**
 * Implements trailing stop loss logic
 */
async function checkTrailingStop(
  position: PositionRow,
  currentPrice: number,
  trailingActivation: number,
  trailingDistance: number
): Promise<void> {
  const { symbol, entry_price, highest_price, stop_loss_price, initial_stop_loss_price } = position;

  const pnlPercent = ((currentPrice - entry_price) / entry_price) * 100;
  const highestPriceValue = highest_price ?? entry_price;

  // Only activate trailing stop if we've hit the activation threshold
  if (pnlPercent < trailingActivation) {
    return;
  }

  // Calculate new trailing stop based on highest price
  const trailingStopPrice = highestPriceValue * (1 - trailingDistance / 100);

  // IMPORTANT: Stop loss should NEVER be below entry price once profitable
  // This ensures we at least break even (no loss of capital)
  const minStopLoss = entry_price;
  const newStopLoss = Math.max(trailingStopPrice, minStopLoss);

  // Only update stop loss if new stop is higher than current stop loss
  const currentStopLoss = stop_loss_price ?? initial_stop_loss_price ?? 0;
  if (newStopLoss > currentStopLoss) {
    log.info(
      `📈 Trailing stop updated for ${symbol}: ` +
        `${currentStopLoss.toFixed(2)} → ${newStopLoss.toFixed(2)} ` +
        `(Entry: ${entry_price.toFixed(2)}, High: ${highestPriceValue.toFixed(2)}, Current: ${currentPrice.toFixed(2)})`
    );
    await updatePositionStopLoss(position.id, newStopLoss);
  }
}

/**
 * Executes a SELL order to close a position
 */
async function executeSellOrder(
  client: BinanceClient,
  position: PositionRow,
  closeReason: 'CLOSED' | 'STOPPED_OUT' | 'TAKE_PROFIT'
): Promise<void> {
  const { symbol } = position;

  try {
    // Get current price for validation
    const ticker = await client.get24hTicker(symbol);
    const currentPrice = Number(ticker.lastPrice);

    // Get symbol filters (lot size, minNotional)
    const filters = await getSymbolFilters(client, symbol);

    // Round quantity down to allowed step size
    let quantity = roundToStepSize(position.quantity, filters.stepSize);
    const precision = filters.stepSize.toString().split('.')[1]?.length || 0;

    if (quantity < filters.minQty) {
      log.warn(
        `🚫 SELL BLOCKED for ${symbol}: Rounded quantity ${quantity} below minQty ${filters.minQty}`
      );
      return;
    }

    // Check if order value meets minimum notional
    const orderValue = quantity * currentPrice;
    if (orderValue < filters.minNotional) {
      log.warn(
        `🚫 SELL BLOCKED for ${symbol}: Order value ${orderValue.toFixed(2)} USDT < minimum ${filters.minNotional} USDT`
      );
      log.warn(
        `   Quantity: ${quantity.toFixed(8)} @ ${currentPrice.toFixed(2)} = ${orderValue.toFixed(2)} USDT`
      );
      log.warn(`   Reason: ${closeReason}`);
      log.info(
        `   Position will be kept open. Consider closing manually when order value is larger.`
      );
      return;
    }

    const clientOrderId = `bot_exit_${Date.now()}_${symbol}`;
    const request = {
      symbol,
      side: 'SELL' as const,
      type: 'MARKET' as const,
      quantity: quantity.toFixed(precision),
    };

    const response = await client.createOrder(request);

    // Persist exit order
    await insertOrder({
      symbol,
      side: 'SELL',
      type: 'MARKET',
      qty: quantity,
      status: 'NEW',
      binance_order_id: response.orderId.toString(),
      client_order_id: clientOrderId,
      request_json: request,
      response_json: response,
    });

    // Close position
    await closePosition(position.id, response.orderId.toString(), closeReason);

    const pnlUsdt = (position.current_price - position.entry_price) * position.quantity;
    const pnlPercent =
      ((position.current_price - position.entry_price) / position.entry_price) * 100;

    log.info(
      `✅ Position closed for ${symbol} (${closeReason}): ` +
        `PnL ${pnlUsdt.toFixed(2)} USDT (${pnlPercent.toFixed(2)}%) | Order ${response.orderId}`
    );

    // Add symbol to cooldown based on close reason
    if (closeReason === 'STOPPED_OUT') {
      // Stop loss hit - add long cooldown
      addSymbolCooldown(symbol, 'stop_loss', pnlPercent);
    } else if (closeReason === 'TAKE_PROFIT') {
      // Take profit hit - add short cooldown
      addSymbolCooldown(symbol, 'take_profit');
    }
  } catch (error) {
    log.error(`Failed to execute sell order for ${symbol}:`, error);
    throw error;
  }
}
