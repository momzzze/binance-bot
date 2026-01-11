-- Positions table to track open positions with stop loss and take profit
CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL, -- LONG | SHORT (for now just LONG)
  entry_price NUMERIC NOT NULL,
  quantity NUMERIC NOT NULL,
  current_price NUMERIC NOT NULL,
  stop_loss_price NUMERIC,
  take_profit_price NUMERIC,
  initial_stop_loss_price NUMERIC, -- Original stop loss for reference
  pnl_usdt NUMERIC DEFAULT 0,
  pnl_percent NUMERIC DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN | CLOSED | STOPPED_OUT | TAKE_PROFIT
  entry_order_id TEXT, -- Reference to orders table binance_order_id
  exit_order_id TEXT, -- Reference to exit order
  trailing_stop_enabled BOOLEAN DEFAULT false,
  highest_price NUMERIC, -- Track highest price for trailing stop
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_positions_symbol_status ON positions(symbol, status);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
