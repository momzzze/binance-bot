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

export type DailyHistory = {
  trade_date: string;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: string | number;
  total_pnl_usdt: number;
  total_commission_usdt: number;
  net_pnl_usdt: number;
  avg_pnl_percent: number;
  best_trade_usdt: number;
  worst_trade_usdt: number;
  total_pnl_usdc?: number;
  total_commission_usdc?: number;
  net_pnl_usdc?: number;
  best_trade_usdc?: number;
  worst_trade_usdc?: number;
};

export type Balance = {
  asset: string;
  free: number;
  locked: number;
  total: number;
  isTrading: boolean;
  activePositions: number;
  unrealizedPnl: number;
  isKeyAsset: boolean;
};

export type AccountInfo = {
  balances: Balance[];
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  updateTime: number;
};

export const botService = {
  getStatus: () => api<BotStatus>('/bot/status'),
  getAccount: () => api<AccountInfo>('/bot/account'),
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
  getStatsHistory: (days: number = 90) =>
    api<{ history: DailyHistory[] }>(`/bot/stats/history?days=${days}`),
};
