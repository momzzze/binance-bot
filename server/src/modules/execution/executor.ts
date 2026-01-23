import type { BinanceClient } from '../exchange/binanceClient.js';
import type { BotConfig } from '../../config/env.js';
import type { Decision } from '../strategy/simpleStrategy.js';
import { getActiveStrategyConfig } from '../db/queries/strategy_config.js';
import { validateOrder } from '../risk/riskEngine.js';
import { isSymbolOnCooldown } from '../risk/symbolCooldown.js';
import { insertOrder, updateOrderStatus } from '../db/queries/orders.js';
import { createPosition } from '../db/queries/positions.js';
import { createLogger } from '../../services/logger.js';
import { sleep } from '../../utils/sleep.js';

const log = createLogger('executor');

// Buffer so positions stay above exchange minNotional after a drawdown
// e.g. 1.2 = 20% cushion; prevents getting stuck below minNotional on exit
const MIN_NOTIONAL_BUFFER = 1.2;

// Cache for symbol filters
const symbolFiltersCache = new Map<
  string,
  { minQty: number; stepSize: number; minNotional: number }
>();

export interface ExecutionResult {
  symbol: string;
  success: boolean;
  orderId?: string;
  reason: string;
}

/**
 * Fetch and cache LOT_SIZE filter for a symbol
 */
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
    minNotional: notionalFilter?.minNotional ? parseFloat(notionalFilter.minNotional) : 10, // Default to $10
  };

  symbolFiltersCache.set(symbol, filters);
  return filters;
}

/**
 * Round quantity to match Binance LOT_SIZE stepSize
 */
function roundToStepSize(quantity: number, stepSize: number): number {
  const precision = stepSize.toString().split('.')[1]?.length || 0;
  return Math.floor(quantity / stepSize) * stepSize;
}

/**
 * Calculate order quantity based on risk management.
 * Position size = Risk amount / (Entry price - Stop loss price)
 */
function calculateOrderQuantity(
  entryPrice: number,
  stopLossPrice: number,
  riskAmountUSDT: number
): number {
  const priceRiskPerUnit = entryPrice - stopLossPrice;
  if (priceRiskPerUnit <= 0) {
    throw new Error('Stop loss price must be below entry price');
  }
  return riskAmountUSDT / priceRiskPerUnit;
}

/**
 * Calculates order quantity based on risk per trade and stop loss distance.
 * Position size = Risk amount / (Entry price - Stop loss price)
 */
async function executeBuyOrder(
  client: BinanceClient,
  decision: Decision,
  config: BotConfig
): Promise<ExecutionResult> {
  const { symbol, meta } = decision;
  const { currentPrice } = meta;

  // Check if symbol is on cooldown (recently closed at a loss)
  if (isSymbolOnCooldown(symbol)) {
    log.info(`⏳ ${symbol} is on cooldown - skipping buy`);
    return {
      symbol,
      success: false,
      reason: 'Symbol on cooldown after recent close',
    };
  }

  // Use strategy settings from DB if available; fall back to env config
  const strategy = await getActiveStrategyConfig();
  const stopLossPercent = strategy ? Number(strategy.stop_loss_percent) : config.STOP_LOSS_PERCENT;
  const takeProfitPercent = strategy
    ? Number(strategy.take_profit_percent)
    : config.TAKE_PROFIT_PERCENT;
  const trailingEnabled = strategy ? strategy.trailing_stop_enabled : config.TRAILING_STOP_ENABLED;
  const trailingActivation = strategy
    ? Number(strategy.trailing_stop_activation_percent)
    : config.TRAILING_STOP_ACTIVATION_PERCENT;
  const trailingDistance = strategy
    ? Number(strategy.trailing_stop_distance_percent)
    : config.TRAILING_STOP_DISTANCE_PERCENT;
  const riskPerTradePercent = strategy
    ? Number(strategy.risk_per_trade_percent)
    : config.RISK_PER_TRADE_PERCENT;

  // Get base asset balance (USDC by default)
  const account = await client.getAccountInfo();
  const baseBalance = Number(
    account.balances.find((b) => b.asset === config.BASE_ASSET)?.free || 0
  );

  if (baseBalance === 0) {
    log.warn(`No ${config.BASE_ASSET} balance available for trading`);
    return {
      symbol,
      success: false,
      reason: `No ${config.BASE_ASSET} balance`,
    };
  }

  // Apply trading capital limit (only use X% of total balance)
  const tradingCapital = (baseBalance * config.MAX_TRADING_CAPITAL_PERCENT) / 100;
  const riskAmountUSDT = (tradingCapital * riskPerTradePercent) / 100;

  log.info(
    `💰 ${config.BASE_ASSET} Balance: ${baseBalance.toFixed(2)} | Trading Capital (${config.MAX_TRADING_CAPITAL_PERCENT}%): ${tradingCapital.toFixed(2)} | Risk per trade: ${riskAmountUSDT.toFixed(2)}`
  );

  // Calculate stop loss and take profit prices
  const stopLossPrice = currentPrice * (1 - stopLossPercent / 100);
  const takeProfitPrice = currentPrice * (1 + takeProfitPercent / 100);

  // Calculate position size based on risk
  let quantity = calculateOrderQuantity(currentPrice, stopLossPrice, riskAmountUSDT);

  // Apply LOT_SIZE filters from Binance
  const filters = await getSymbolFilters(client, symbol);
  quantity = roundToStepSize(quantity, filters.stepSize);

  // Ensure minimum quantity
  if (quantity < filters.minQty) {
    log.warn(`Calculated quantity ${quantity} is below minimum ${filters.minQty} for ${symbol}`);
    return {
      symbol,
      success: false,
      reason: `Quantity too small (min: ${filters.minQty})`,
    };
  }

  // Ensure minimum notional value
  let orderValueUSDT = quantity * currentPrice;
  const minNotionalWithBuffer = filters.minNotional * MIN_NOTIONAL_BUFFER;
  if (orderValueUSDT < minNotionalWithBuffer) {
    log.warn(
      `Order value ${orderValueUSDT.toFixed(2)} USDT is below minNotional buffer ${minNotionalWithBuffer.toFixed(2)} (exchange min ${filters.minNotional}) for ${symbol}`
    );
    // Increase quantity to meet buffered minimum notional so we can later exit even after a drawdown
    quantity =
      Math.ceil(minNotionalWithBuffer / currentPrice / filters.stepSize) * filters.stepSize;
    orderValueUSDT = quantity * currentPrice;
    log.info(
      `Adjusted quantity to ${quantity} to meet buffered minimum notional (new value: ${orderValueUSDT.toFixed(2)} USDT)`
    );
  }

  // Check if we have sufficient balance for this order
  if (tradingCapital < orderValueUSDT) {
    log.warn(
      `Insufficient trading capital: ${tradingCapital.toFixed(2)} ${config.BASE_ASSET} < ${orderValueUSDT.toFixed(2)} needed for ${symbol}`
    );
    return {
      symbol,
      success: false,
      reason: `Insufficient capital (have: ${tradingCapital.toFixed(2)} ${config.BASE_ASSET}, need: ${orderValueUSDT.toFixed(2)})`,
    };
  }
  log.info(
    `Attempting to buy ${quantity} ${symbol} @ ${currentPrice.toFixed(2)} ${config.BASE_ASSET}`
  );
  log.info(
    `  Stop Loss: ${stopLossPrice.toFixed(2)} (${stopLossPercent}%) | Take Profit: ${takeProfitPrice.toFixed(2)} (${takeProfitPercent}%)`
  );
  log.info(
    `  Balance: ${baseBalance.toFixed(2)} ${config.BASE_ASSET} | Trading Capital: ${tradingCapital.toFixed(2)} | Risk: ${riskAmountUSDT.toFixed(2)} (${riskPerTradePercent}%) | Position: ${orderValueUSDT.toFixed(2)}`
  );

  // Validate order against risk limits
  const validation = await validateOrder(symbol, riskAmountUSDT, config);
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

    // Determine precision from stepSize
    const precision = filters.stepSize.toString().split('.')[1]?.length || 0;

    const request = {
      symbol,
      side: 'BUY' as const,
      type: 'MARKET' as const,
      quantity: quantity.toFixed(precision),
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
      trailing_stop_enabled: trailingEnabled,
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
