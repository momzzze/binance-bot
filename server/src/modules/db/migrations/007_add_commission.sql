-- Add commission tracking to positions
ALTER TABLE positions 
ADD COLUMN IF NOT EXISTS entry_commission NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS exit_commission NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_commission NUMERIC GENERATED ALWAYS AS (COALESCE(entry_commission, 0) + COALESCE(exit_commission, 0)) STORED;

COMMENT ON COLUMN positions.entry_commission IS 'Trading fee paid on entry (in USDT)';
COMMENT ON COLUMN positions.exit_commission IS 'Trading fee paid on exit (in USDT)';
COMMENT ON COLUMN positions.total_commission IS 'Total trading fees (entry + exit)';
