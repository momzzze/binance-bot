-- Store historical candlestick data for backtesting and charting
CREATE TABLE IF NOT EXISTS candles (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL, -- '1m', '5m', '15m', '1h', '4h', '1d'
  open_time BIGINT NOT NULL, -- Unix timestamp in milliseconds
  open NUMERIC NOT NULL,
  high NUMERIC NOT NULL,
  low NUMERIC NOT NULL,
  close NUMERIC NOT NULL,
  volume NUMERIC NOT NULL,
  close_time BIGINT NOT NULL,
  quote_asset_volume NUMERIC,
  number_of_trades INTEGER,
  taker_buy_base_asset_volume NUMERIC,
  taker_buy_quote_asset_volume NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure no duplicate candles for same symbol/interval/time
  UNIQUE(symbol, interval, open_time)
);

-- Index for fast lookups by symbol + interval + time range
CREATE INDEX IF NOT EXISTS idx_candles_symbol_interval_time 
  ON candles(symbol, interval, open_time DESC);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_candles_created_at 
  ON candles(created_at);
