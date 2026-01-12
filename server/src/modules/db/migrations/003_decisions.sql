-- Optional decisions table
CREATE TABLE IF NOT EXISTS decisions (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  signal TEXT NOT NULL, -- BUY | SELL | HOLD
  score NUMERIC,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decisions_symbol_created_at ON decisions(symbol, created_at);
