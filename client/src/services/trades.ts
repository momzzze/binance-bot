import { api } from './api';

export type Trade = {
  id: string;
  symbol: string;
  side: string;
  type: string;
  qty: number;
  status: string;
  binance_order_id?: string | null;
  client_order_id?: string | null;
  request_json?: unknown;
  response_json?: unknown;
  created_at: string;
  updated_at: string;
};

export type TradeStats = {
  symbol?: string;
  total_orders: number;
  buy_orders: number;
  sell_orders: number;
  total_qty_filled: number;
  buy_qty_filled: number;
  sell_qty_filled: number;
  filled_count: number;
  canceled_count: number;
};

export type TradesResponse = {
  trades: Trade[];
  total: number;
  count: number;
  limit: number;
  offset: number;
};

export type SignalsResponse = {
  symbol: string;
  signals: unknown[];
  count: number;
};

export const tradesService = {
  getTrades: (
    params: {
      symbol?: string;
      side?: string;
      limit?: number;
      offset?: number;
    } = {}
  ) => {
    const q = new URLSearchParams();
    if (params.symbol) q.set('symbol', params.symbol);
    if (params.side) q.set('side', params.side);
    if (params.limit) q.set('limit', String(params.limit));
    if (params.offset) q.set('offset', String(params.offset));
    const query = q.toString();
    return api<TradesResponse>(`/trades${query ? `?${query}` : ''}`);
  },

  getStats: (symbol?: string) => {
    const query = symbol ? `?symbol=${encodeURIComponent(symbol)}` : '';
    return api<TradeStats>(`/trades/stats${query}`);
  },

  getSummary: () =>
    api<{ timestamp: string; overall: TradeStats }>(`/trades/summary`),

  getSignals: (symbol: string, limit = 50) => {
    const q = new URLSearchParams();
    q.set('symbol', symbol);
    q.set('limit', String(limit));
    return api<SignalsResponse>(`/trades/signals?${q.toString()}`);
  },
};
