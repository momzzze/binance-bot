import { api } from './api';

export type BotStatus = {
  running: boolean;
  symbols: string[];
  symbolSource: string;
  loopMs: number;
  tradingEnabled: boolean;
  killSwitch: boolean;
};

export type Position = {
  id: string;
  symbol: string;
  side: string;
  entry_price: number;
  quantity: number;
  current_price: number;
  stop_loss_price?: number | null;
  take_profit_price?: number | null;
  pnl_usdt: number;
  pnl_percent: number;
  status: string;
  highest_price?: number | null;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
};

export type DailyStats = {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: string;
  total_pnl_usdt: number;
  avg_pnl_percent: number;
  best_trade_usdt: number;
  worst_trade_usdt: number;
};

export const botService = {
  getStatus: () => api<BotStatus>('/bot/status'),
  start: () =>
    api<{ message: string; running: boolean }>('/bot/start', {
      method: 'POST',
    }),
  stop: () =>
    api<{ message: string; running: boolean }>('/bot/stop', { method: 'POST' }),
  getPositions: () => api<{ positions: Position[] }>('/bot/positions'),
  closePosition: (id: string) =>
    api<{ message: string; orderId: number }>(`/bot/positions/${id}/close`, {
      method: 'POST',
    }),
  updateStopLoss: (id: string, stopLossPrice: number) =>
    api<{ message: string; stop_loss_price: number }>(
      `/bot/positions/${id}/stop-loss`,
      {
        method: 'PATCH',
        body: JSON.stringify({ stop_loss_price: stopLossPrice }),
      }
    ),
  getClosedPositions: (
    params: { symbol?: string; limit?: number; offset?: number } = {}
  ) => {
    const q = new URLSearchParams();
    if (params.symbol) q.set('symbol', params.symbol);
    if (params.limit) q.set('limit', String(params.limit));
    if (params.offset) q.set('offset', String(params.offset));
    const query = q.toString();
    return api<{ positions: Position[] }>(
      `/bot/positions/closed${query ? `?${query}` : ''}`
    );
  },
  getDailyStats: () => api<{ today: DailyStats }>('/bot/stats/daily'),
};
