/**
 * Simple time utilities for the bot
 */

export function nowMs(): number {
  return Date.now();
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString();
}
