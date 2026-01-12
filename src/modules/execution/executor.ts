import type { BinanceClient } from '../exchange/binanceClient.js';
import type { BotConfig } from '../../config/env.js';
import type { Decision } from '../strategy/simpleStrategy.js';
import { validateOrder } from '../risk/riskEngine.js';
import { insertOrder, updateOrderStatus } from '../db/queries/orders.js';
import { createPosition } from '../db/queries/positions.js';
import { createLogger } from '../../services/logger.js';
import { sleep } from '../../utils/sleep.js';

const log = createLogger('executor');

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
 * Ensures minimum USDT balance by selling BTC if needed
 */
async function ensureMinimumUsdtBalance(
  client: BinanceClient,
  minUsdtBalance: number = 50,
  targetUsdtBalance: number = 100
): Promise<void> {
  try {
    const account = await client.getAccountInfo();
    const usdtBalance = Number(account.balances.find((b) => b.asset === 'USDT')?.free || 0);
    const btcBalance = Number(account.balances.find((b) => b.asset === 'BTC')?.free || 0);

    // If USDT balance is sufficient, do nothing
    if (usdtBalance >= minUsdtBalance) {
      return;
    }

    // If no BTC to sell, log warning and return
    if (btcBalance < 0.001) {
      log.warn(`⚠ Insufficient USDT (${usdtBalance.toFixed(2)}) and no BTC to sell`);
      return;
    }

    // Get current BTC price
    const ticker = await client.getPrice('BTCUSDT');
    const btcPrice = parseFloat(ticker.price);

    // Calculate how much BTC to sell to reach target USDT balance
    const usdtNeeded = targetUsdtBalance - usdtBalance;
    const btcToSell = usdtNeeded / btcPrice;

    // Get exchange info for LOT_SIZE filter
    const filters = await getSymbolFilters(client, 'BTCUSDT');
    const { stepSize, minQty } = filters;

    // Round to step size and cap at 50% of BTC balance
    const btcToSellRounded = roundToStepSize(Math.min(btcToSell, btcBalance * 0.5), stepSize);

    // Check if we have enough BTC to sell
    if (btcToSellRounded < minQty) {
      log.warn(`⚠ Need to sell ${btcToSell.toFixed(8)} BTC but below minimum ${minQty}`);
      return;
    }

    log.info(
      `💱 Low USDT balance (${usdtBalance.toFixed(2)}). Selling ${btcToSellRounded} BTC (~$${(btcToSellRounded * btcPrice).toFixed(2)})`
    );

    // Sell BTC for USDT
    const order = await client.createOrder({
      symbol: 'BTCUSDT',
      side: 'SELL',
      type: 'MARKET',
      quantity: btcToSellRounded.toFixed(8),
    });

    log.info(`✓ Sold ${btcToSellRounded} BTC for USDT. Order ID: ${order.orderId}`);
  } catch (error) {
    log.error('Failed to ensure minimum USDT balance:', error);
  }
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

  // Ensure we have minimum USDT balance by selling BTC if needed
  await ensureMinimumUsdtBalance(client);

  // Get current USDT balance
  const account = await client.getAccountInfo();
  const usdtBalance = Number(account.balances.find((b) => b.asset === 'USDT')?.free || 0);
  const riskAmountUSDT = (usdtBalance * config.RISK_PER_TRADE_PERCENT) / 100;

  // Calculate stop loss and take profit prices
  const stopLossPrice = currentPrice * (1 - config.STOP_LOSS_PERCENT / 100);
  const takeProfitPrice = currentPrice * (1 + config.TAKE_PROFIT_PERCENT / 100);

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
  if (orderValueUSDT < filters.minNotional) {
    log.warn(
      `Order value ${orderValueUSDT.toFixed(2)} USDT is below minimum notional ${filters.minNotional} for ${symbol}`
    );
    // Increase quantity to meet minimum notional
    quantity = Math.ceil(filters.minNotional / currentPrice / filters.stepSize) * filters.stepSize;
    orderValueUSDT = quantity * currentPrice;
    log.info(
      `Adjusted quantity to ${quantity} to meet minimum notional (new value: ${orderValueUSDT.toFixed(2)} USDT)`
    );
  }

  // Check if we have sufficient balance for this order
  if (usdtBalance < orderValueUSDT) {
    log.warn(
      `Insufficient balance: ${usdtBalance.toFixed(2)} USDT < ${orderValueUSDT.toFixed(2)} USDT needed for ${symbol}`
    );
    return {
      symbol,
      success: false,
      reason: `Insufficient balance (have: ${usdtBalance.toFixed(2)} USDT, need: ${orderValueUSDT.toFixed(2)} USDT)`,
    };
  }
  log.info(`Attempting to buy ${quantity} ${symbol} @ ${currentPrice.toFixed(2)} USDT`);
  log.info(
    `  Stop Loss: ${stopLossPrice.toFixed(2)} (${config.STOP_LOSS_PERCENT}%) | Take Profit: ${takeProfitPrice.toFixed(2)} (${config.TAKE_PROFIT_PERCENT}%)`
  );
  log.info(
    `  Balance: ${usdtBalance.toFixed(2)} USDT | Risk: ${riskAmountUSDT.toFixed(2)} USDT (${config.RISK_PER_TRADE_PERCENT}%) | Position: ${orderValueUSDT.toFixed(2)} USDT`
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
