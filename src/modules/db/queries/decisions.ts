import { query } from '../db.js';
import type { Decision } from '../../strategy/simpleStrategy.js';

export interface DecisionRow {
  id: string;
  symbol: string;
  signal: string;
  score: number;
  meta: Record<string, unknown>;
  created_at: Date;
}

/**
 * Inserts a trading decision into the database.
 */
export async function insertDecision(decision: Decision): Promise<void> {
  await query(
    `INSERT INTO decisions (symbol, signal, score, meta)
     VALUES ($1, $2, $3, $4)`,
    [decision.symbol, decision.signal, decision.score, JSON.stringify(decision.meta)]
  );
}

/**
 * Inserts multiple decisions in a batch.
 */
export async function insertDecisions(decisions: Decision[]): Promise<void> {
  if (decisions.length === 0) {
    return;
  }

  const values = decisions
    .map((d, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`)
    .join(',\n    ');

  const params = decisions.flatMap((d) => [d.symbol, d.signal, d.score, JSON.stringify(d.meta)]);

  await query(
    `INSERT INTO decisions (symbol, signal, score, meta)
     VALUES ${values}`,
    params
  );
}

/**
 * Gets recent decisions for a symbol.
 */
export async function getRecentDecisions(
  symbol: string,
  limit: number = 100
): Promise<DecisionRow[]> {
  const result = await query<DecisionRow>(
    `SELECT id, symbol, signal, score, meta, created_at
     FROM decisions
     WHERE symbol = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [symbol, limit]
  );
  return result.rows;
}
