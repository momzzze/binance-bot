import { api } from './api';

export interface StrategyConfig {
  id: number;
  strategy_name: string;
  is_active: boolean;
  sma_short_period: number;
  sma_long_period: number;
  ema_short_period: number;
  ema_long_period: number;
  rsi_period: number;
  rsi_overbought: number;
  rsi_oversold: number;
  buy_score_threshold: number;
  sell_score_threshold: number;
  stop_loss_percent: string;
  take_profit_percent: string;
  trailing_stop_enabled: boolean;
  trailing_stop_activation_percent: string;
  trailing_stop_distance_percent: string;
  risk_per_trade_percent: string;
  min_volume_usdt: string;
  require_volume_spike: boolean;
  volume_spike_multiplier: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface StrategyConfigUpdate {
  sma_short_period?: number;
  sma_long_period?: number;
  ema_short_period?: number;
  ema_long_period?: number;
  rsi_period?: number;
  rsi_overbought?: number;
  rsi_oversold?: number;
  buy_score_threshold?: number;
  sell_score_threshold?: number;
  stop_loss_percent?: number;
  take_profit_percent?: number;
  trailing_stop_enabled?: boolean;
  trailing_stop_activation_percent?: number;
  trailing_stop_distance_percent?: number;
  risk_per_trade_percent?: number;
  min_volume_usdt?: number;
  require_volume_spike?: boolean;
  volume_spike_multiplier?: number;
  description?: string;
}

export const strategyService = {
  async getActive(): Promise<StrategyConfig> {
    return api('/strategy/active');
  },

  async getAll(): Promise<StrategyConfig[]> {
    return api('/strategy');
  },

  async update(
    name: string,
    updates: StrategyConfigUpdate
  ): Promise<StrategyConfig> {
    return api(`/strategy/${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
  },

  async activate(name: string): Promise<{ success: boolean; message: string }> {
    return api(`/strategy/${name}/activate`, { method: 'POST' });
  },
};
