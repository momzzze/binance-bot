import type { BinanceClient } from '../exchange/binanceClient.js';
import type { BotConfig } from '../../config/env.js';
import type { Decision } from '../strategy/simpleStrategy.js';
import { validateOrder } from '../risk/riskEngine.js';
import { insertOrder, updateOrderStatus } from '../db/queries/orders.js';
import { createPosition } from '../db/queries/positions.js';
import { createLogger } from '../../services/logger.js';
import { sleep } from '../../utils/sleep.js';

const log = createLogger('executor');

export interface ExecutionResult {
  symbol: string;
  success: boolean;
  orderId?: string;
  reason: string;
}

/**
 * Calculates order quantity based on risk per trade and stop loss distance.
 * Position size = Risk amount / (Entry price - Stop loss price)
 */
function calculateOrderQuantity(
  currentPrice: number,
  stopLossPrice: number,
  riskPerTradeUSDT: number
): number {
  const stopLossDistance = Math.abs(currentPrice - stopLossPrice);
  if (stopLossDistance === 0) {
    // Fallback if no stop loss
    return riskPerTradeUSDT / currentPrice;
  }
  // Position size = Risk / Stop distance
  return riskPerTradeUSDT / stopLossDistance;
}

/**
 * Executes a BUY order for a decision.
 */
async function executeBuyOrder(
  client: BinanceClient,
  decision: Decision,
  config: BotConfig
): Promise<ExecutionResult> {
  const { symbol, meta } = decision;
  const { currentPrice } = meta;

  // Calculate stop loss and take profit prices
  const stopLossPrice = currentPrice * (1 - config.STOP_LOSS_PERCENT / 100);
  const takeProfitPrice = currentPrice * (1 + config.TAKE_PROFIT_PERCENT / 100);

  // Calculate position size based on risk
  const quantity = calculateOrderQuantity(currentPrice, stopLossPrice, config.RISK_PER_TRADE_USDT);
  const orderValueUSDT = quantity * currentPrice;

  log.info(`Attempting to buy ${quantity.toFixed(6)} ${symbol} @ ${currentPrice.toFixed(2)} USDT`);
  log.info(
    `  Stop Loss: ${stopLossPrice.toFixed(2)} (${config.STOP_LOSS_PERCENT}%) | Take Profit: ${takeProfitPrice.toFixed(2)} (${config.TAKE_PROFIT_PERCENT}%)`
  );
  log.info(
    `  Position Value: ${orderValueUSDT.toFixed(2)} USDT | Risk: ${config.RISK_PER_TRADE_USDT} USDT`
  );

  // Validate order against risk limits
  const validation = await validateOrder(symbol, config.RISK_PER_TRADE_USDT, config);
  if (!validation.allowed) {
    log.warn(`Order rejected: ${validation.reason}`);
    return {
      symbol,
      success: false,
      reason: validation.reason,
    };
  }

  try {
    // Create order via Binance
    const clientOrderId = `bot_${Date.now()}_${symbol}`;
    const request = {
      symbol,
      side: 'BUY' as const,
      type: 'MARKET' as const,
      quantity: quantity.toFixed(6),
    };

    const response = await client.createOrder(request);

    // Persist order to database
    await insertOrder({
      symbol,
      side: 'BUY',
      type: 'MARKET',
      qty: quantity,
      status: 'NEW',
      binance_order_id: response.orderId.toString(),
      client_order_id: clientOrderId,
      request_json: request,
      response_json: response,
    });

    // Create position with stop loss and take profit
    const position = await createPosition({
      symbol,
      side: 'LONG',
      entry_price: currentPrice,
      quantity,
      current_price: currentPrice,
      stop_loss_price: stopLossPrice,
      take_profit_price: takeProfitPrice,
      initial_stop_loss_price: stopLossPrice,
      entry_order_id: response.orderId.toString(),
      trailing_stop_enabled: config.TRAILING_STOP_ENABLED,
      highest_price: currentPrice,
      status: 'OPEN',
    });

    log.info(`✓ Buy order placed: ${symbol} ${response.orderId}`);
    log.info(`✓ Position created: ID ${position.id}`);
    return {
      symbol,
      success: true,
      orderId: response.orderId.toString(),
      reason: 'Order placed successfully',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(`Failed to place buy order for ${symbol}:`, errorMsg);
    return {
      symbol,
      success: false,
      reason: errorMsg,
    };
  }
}

/**
 * Executes orders based on decisions.
 * For now, only handles BUY signals. SELL logic would be similar.
 */
export async function executeDecisions(
  client: BinanceClient,
  decisions: Decision[],
  config: BotConfig
): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];

  for (const decision of decisions) {
    if (decision.signal === 'BUY') {
      const result = await executeBuyOrder(client, decision, config);
      results.push(result);

      // Rate limit: wait between orders
      await sleep(500);
    } else if (decision.signal === 'SELL') {
      // SELL logic would go here (query open positions, place SELL orders)
      log.debug(`SELL signal for ${decision.symbol} - not implemented yet`);
      results.push({
        symbol: decision.symbol,
        success: false,
        reason: 'SELL logic not implemented',
      });
    } else {
      log.debug(`HOLD signal for ${decision.symbol} - no action`);
    }
  }

  return results;
}

/**
 * Reconciles order status by querying Binance and updating database.
 */
export async function reconcileOrders(client: BinanceClient, orderIds: string[]): Promise<void> {
  if (orderIds.length === 0) {
    return;
  }

  log.info(`Reconciling ${orderIds.length} orders...`);

  for (const orderId of orderIds) {
    try {
      // In production, you'd need to track symbol per order
      // For now, this is a placeholder
      log.debug(`Would reconcile order ${orderId}`);
      // const status = await client.queryOrder(symbol, orderId);
      // await updateOrderStatus(orderId, status.status);
    } catch (error) {
      log.error(`Failed to reconcile order ${orderId}:`, error);
    }

    await sleep(100); // Rate limit
  }
}
