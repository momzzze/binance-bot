import { api } from './api';

export interface Candle {
  id: number;
  symbol: string;
  interval: string;
  open_time: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  close_time: string;
  quote_asset_volume: string | null;
  number_of_trades: number | null;
  taker_buy_base_asset_volume: string | null;
  taker_buy_quote_asset_volume: string | null;
  created_at: string;
}

export const candleService = {
  async getCandles(
    symbol: string,
    interval: string = '1m',
    limit: number = 200
  ): Promise<Candle[]> {
    return api(`/candles/${symbol}?interval=${interval}&limit=${limit}`);
  },
};
