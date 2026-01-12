-- Store strategy configuration (editable from frontend)
CREATE TABLE IF NOT EXISTS strategy_config (
  id SERIAL PRIMARY KEY,
  strategy_name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT false,
  
  -- Indicator parameters
  sma_short_period INTEGER DEFAULT 20,
  sma_long_period INTEGER DEFAULT 50,
  ema_short_period INTEGER DEFAULT 12,
  ema_long_period INTEGER DEFAULT 26,
  rsi_period INTEGER DEFAULT 14,
  rsi_overbought INTEGER DEFAULT 70,
  rsi_oversold INTEGER DEFAULT 30,
  
  -- Entry/Exit thresholds
  buy_score_threshold INTEGER DEFAULT 5,
  sell_score_threshold INTEGER DEFAULT -5,
  
  -- Risk management
  stop_loss_percent NUMERIC DEFAULT 4.0,
  take_profit_percent NUMERIC DEFAULT 5.0,
  trailing_stop_enabled BOOLEAN DEFAULT true,
  trailing_stop_activation_percent NUMERIC DEFAULT 3.0,
  trailing_stop_distance_percent NUMERIC DEFAULT 2.0,
  risk_per_trade_percent NUMERIC DEFAULT 2.0,
  
  -- Filters
  min_volume_usdt NUMERIC DEFAULT 1000000,
  require_volume_spike BOOLEAN DEFAULT false,
  volume_spike_multiplier NUMERIC DEFAULT 1.5,
  
  -- Metadata
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default strategy
INSERT INTO strategy_config (
  strategy_name, 
  is_active, 
  description,
  stop_loss_percent,
  take_profit_percent,
  trailing_stop_activation_percent,
  trailing_stop_distance_percent,
  risk_per_trade_percent
) VALUES (
  'sma-crossover',
  true,
  'SMA crossover with EMA momentum and RSI filters',
  4.0,
  5.0,
  3.0,
  2.0,
  2.0
) ON CONFLICT (strategy_name) DO NOTHING;
