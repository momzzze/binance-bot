-- Daily statistics history table
CREATE TABLE IF NOT EXISTS daily_stats (
  id SERIAL PRIMARY KEY,
  trade_date DATE NOT NULL UNIQUE,
  total_trades INTEGER NOT NULL DEFAULT 0,
  winning_trades INTEGER NOT NULL DEFAULT 0,
  losing_trades INTEGER NOT NULL DEFAULT 0,
  win_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  total_pnl_usdt NUMERIC NOT NULL DEFAULT 0,
  total_commission_usdt NUMERIC NOT NULL DEFAULT 0,
  net_pnl_usdt NUMERIC NOT NULL DEFAULT 0,
  avg_pnl_percent NUMERIC NOT NULL DEFAULT 0,
  best_trade_usdt NUMERIC NOT NULL DEFAULT 0,
  worst_trade_usdt NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_stats_trade_date ON daily_stats(trade_date DESC);

COMMENT ON TABLE daily_stats IS 'Historical daily trading performance metrics';
COMMENT ON COLUMN daily_stats.trade_date IS 'Date of trading activity';
COMMENT ON COLUMN daily_stats.total_pnl_usdt IS 'Gross profit/loss before fees';
COMMENT ON COLUMN daily_stats.total_commission_usdt IS 'Total trading fees paid';
COMMENT ON COLUMN daily_stats.net_pnl_usdt IS 'Net profit/loss after fees';
