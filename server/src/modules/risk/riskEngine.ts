import type { BotConfig } from '../../config/env.js';
import { getKillSwitch, getTradingEnabled } from '../db/queries/bot_state.js';
import { getOpenOrdersCountForSymbol } from '../db/queries/orders.js';
import { getOpenPositionCountForSymbol } from '../db/queries/positions.js';
import { createLogger } from '../../services/logger.js';

const log = createLogger('risk');

export interface OrderValidation {
  allowed: boolean;
  reason: string;
}

/**
 * Checks if the bot is allowed to trade.
 */
export async function checkGlobalTrading(): Promise<OrderValidation> {
  const killSwitch = await getKillSwitch();
  if (killSwitch) {
    log.warn('Kill switch is ON - trading disabled');
    return { allowed: false, reason: 'Kill switch is active' };
  }

  const tradingEnabled = await getTradingEnabled();
  if (!tradingEnabled) {
    log.warn('Trading is disabled in bot_state');
    return { allowed: false, reason: 'Trading is disabled' };
  }

  return { allowed: true, reason: 'OK' };
}

/**
 * Validates if an order can be placed based on risk limits.
 */
export async function validateOrder(
  symbol: string,
  orderValueUSDT: number,
  config: BotConfig
): Promise<OrderValidation> {
  // Check global trading status
  const globalCheck = await checkGlobalTrading();
  if (!globalCheck.allowed) {
    return globalCheck;
  }

  // Check risk per trade limit
  if (orderValueUSDT > config.RISK_PER_TRADE_USDT) {
    log.warn(
      `Order value ${orderValueUSDT.toFixed(2)} USDT exceeds risk per trade ${config.RISK_PER_TRADE_USDT} USDT`
    );
    return {
      allowed: false,
      reason: `Order value ${orderValueUSDT.toFixed(2)} exceeds risk limit ${config.RISK_PER_TRADE_USDT}`,
    };
  }

  // Check max open positions per symbol
  const openPositionsCount = await getOpenPositionCountForSymbol(symbol);
  if (openPositionsCount >= config.MAX_OPEN_ORDERS_PER_SYMBOL) {
    log.warn(
      `Symbol ${symbol} has ${openPositionsCount} open positions (max: ${config.MAX_OPEN_ORDERS_PER_SYMBOL})`
    );
    return {
      allowed: false,
      reason: `Max open positions (${config.MAX_OPEN_ORDERS_PER_SYMBOL}) reached for ${symbol}`,
    };
  }

  log.info(
    `Risk check passed for ${symbol}: ${orderValueUSDT.toFixed(2)} USDT, ${openPositionsCount} open positions`
  );
  return { allowed: true, reason: 'OK' };
}
