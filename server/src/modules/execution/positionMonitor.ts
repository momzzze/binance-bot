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
import { createLogger } from '../../services/logger.js';

const log = createLogger('positionMonitor');

/**
 * Checks all open positions and executes stop loss or take profit if triggered
 */
export async function monitorPositions(client: BinanceClient, config: BotConfig): Promise<void> {
  const openPositions = await getOpenPositions();

  if (openPositions.length === 0) {
    return;
  }

  log.info(`Monitoring ${openPositions.length} open positions...`);

  for (const position of openPositions) {
    try {
      await checkPosition(client, position, config);
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
  config: BotConfig
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
  if (position.trailing_stop_enabled && config.TRAILING_STOP_ENABLED) {
    await checkTrailingStop(position, currentPrice, config);
  }
}

/**
 * Implements trailing stop loss logic
 */
async function checkTrailingStop(
  position: PositionRow,
  currentPrice: number,
  config: BotConfig
): Promise<void> {
  const { symbol, entry_price, highest_price, stop_loss_price, initial_stop_loss_price } = position;

  const pnlPercent = ((currentPrice - entry_price) / entry_price) * 100;
  const highestPriceValue = highest_price ?? entry_price;

  // Only activate trailing stop if we've hit the activation threshold
  if (pnlPercent < config.TRAILING_STOP_ACTIVATION_PERCENT) {
    return;
  }

  // Calculate new trailing stop based on highest price
  const trailingStopPrice = highestPriceValue * (1 - config.TRAILING_STOP_DISTANCE_PERCENT / 100);

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
  const { symbol, quantity } = position;

  try {
    const clientOrderId = `bot_exit_${Date.now()}_${symbol}`;
    const request = {
      symbol,
      side: 'SELL' as const,
      type: 'MARKET' as const,
      quantity: quantity.toFixed(6),
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
    log.info(
      `✅ Position closed for ${symbol} (${closeReason}): ` +
        `PnL ${pnlUsdt.toFixed(2)} USDT | Order ${response.orderId}`
    );
  } catch (error) {
    log.error(`Failed to execute sell order for ${symbol}:`, error);
    throw error;
  }
}
