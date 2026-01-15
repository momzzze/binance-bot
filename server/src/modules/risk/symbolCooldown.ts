import { createLogger } from '../../services/logger.js';

const log = createLogger('cooldown');

interface CooldownEntry {
  symbol: string;
  reason: 'stop_loss' | 'take_profit' | 'manual_sell';
  closedAt: number;
  lossPercent?: number;
}

// In-memory cooldown tracker
// TODO: Consider moving to database for persistence across restarts
const cooldownMap = new Map<string, CooldownEntry>();

// Cooldown durations in milliseconds
const COOLDOWN_DURATION = {
  stop_loss: 60 * 60 * 1000, // 1 hour for stop loss hits
  manual_sell: 30 * 60 * 1000, // 30 minutes for manual sells
  take_profit: 15 * 60 * 1000, // 15 minutes for take profits (shorter, it was a win)
};

/**
 * Add a symbol to cooldown after closing a position
 */
export function addSymbolCooldown(
  symbol: string,
  reason: CooldownEntry['reason'],
  lossPercent?: number
): void {
  const entry: CooldownEntry = {
    symbol,
    reason,
    closedAt: Date.now(),
    lossPercent,
  };

  cooldownMap.set(symbol, entry);

  const durationMinutes = Math.round(COOLDOWN_DURATION[reason] / 60000);
  const lossInfo = lossPercent !== undefined ? ` (${lossPercent.toFixed(2)}% loss)` : '';
  log.info(
    `🚫 ${symbol} added to cooldown for ${durationMinutes}min - reason: ${reason}${lossInfo}`
  );
}

/**
 * Check if a symbol is currently on cooldown
 */
export function isSymbolOnCooldown(symbol: string): boolean {
  const entry = cooldownMap.get(symbol);

  if (!entry) {
    return false;
  }

  const elapsed = Date.now() - entry.closedAt;
  const cooldownDuration = COOLDOWN_DURATION[entry.reason];

  if (elapsed < cooldownDuration) {
    const remainingMinutes = Math.ceil((cooldownDuration - elapsed) / 60000);
    log.debug(
      `⏳ ${symbol} on cooldown - ${remainingMinutes}min remaining (reason: ${entry.reason})`
    );
    return true;
  }

  // Cooldown expired, remove it
  log.info(`✓ ${symbol} cooldown expired`);
  cooldownMap.delete(symbol);
  return false;
}

/**
 * Get cooldown info for a symbol (useful for logging/debugging)
 */
export function getCooldownInfo(symbol: string): CooldownEntry | null {
  return cooldownMap.get(symbol) || null;
}

/**
 * Manually remove a symbol from cooldown (admin override)
 */
export function removeCooldown(symbol: string): boolean {
  const removed = cooldownMap.delete(symbol);
  if (removed) {
    log.info(`✓ ${symbol} manually removed from cooldown`);
  }
  return removed;
}

/**
 * Get all symbols currently on cooldown
 */
export function getActiveCooldowns(): CooldownEntry[] {
  const now = Date.now();
  const active: CooldownEntry[] = [];

  for (const [symbol, entry] of cooldownMap.entries()) {
    const elapsed = now - entry.closedAt;
    const duration = COOLDOWN_DURATION[entry.reason];

    if (elapsed < duration) {
      active.push(entry);
    } else {
      // Clean up expired
      cooldownMap.delete(symbol);
    }
  }

  return active;
}

/**
 * Clear all cooldowns (use with caution)
 */
export function clearAllCooldowns(): void {
  const count = cooldownMap.size;
  cooldownMap.clear();
  log.warn(`🗑️ Cleared ${count} symbol cooldowns`);
}
