-- Orders table
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL, -- BUY | SELL
  type TEXT NOT NULL, -- MARKET
  qty NUMERIC NOT NULL,
  status TEXT NOT NULL,
  binance_order_id TEXT,
  client_order_id TEXT,
  request_json JSONB,
  response_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_symbol_status ON orders(symbol, status);
