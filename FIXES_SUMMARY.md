# Bot Improvements: Position Closing & Min Entry Size

## Problems Fixed

1. **Positions not closing at stop-loss**: ADAUSDC was down -7.79% but stop-loss (2%) wasn't triggered
   - **Root cause**: Monitoring was being skipped if `tradingCheck` failed (trading disabled)
   - **Fix**: Made monitoring always run independently of trading enabled/disabled status

2. **Stuck small positions (< $5)**: Can't close manually because below Binance minNotional ($10)
   - **Fix 1**: Added minimum entry notional check (`MIN_ENTRY_NOTIONAL = $15`) to prevent opening positions that might become uncloseable
   - **Fix 2**: Added force-close endpoint to clear stuck positions from tracking

## Changes Made

### 1. Executor (`server/src/modules/execution/executor.ts`)

- Added `MIN_ENTRY_NOTIONAL = $15` constant
- Added checks to skip entries if:
  - Capped notional < $15 (prevents opening positions too small to close)
  - Capped notional < buffered minNotional ($12 = $10 × 1.2)
- Final guard: Skip if entry notional < $15

**Effect**: No more positions under $15 USDT will be opened, preventing minNotional closure issues.

### 2. Position Monitor (`server/src/modules/execution/positionMonitor.ts`)

- Enhanced stop-loss logging to show distance from trigger
- Added `forceClose` parameter to `executeSellOrder()` function
- Added force-close logic that attempts sell even if below minNotional

### 3. Bot Runner (`server/src/modules/runner/botRunner.ts`)

- **CRITICAL FIX**: Moved `monitorPositions()` BEFORE trading check
- Now positions are monitored every iteration regardless of trading enabled/disabled status
- Added comment clarifying this is intentional

### 4. API Routes (`server/src/routes/v1/bot.ts`)

- Added `POST /bot/positions/:id/force-close` endpoint
  - Attempts to close position even if below minNotional
  - On exchange failure, marks position as closed in DB anyway
  - Returns helpful warning messages

## Configuration

Edit `server/.env` if needed:

```dotenv
INTERVAL="5m"              # MA7/MA99 computed on 5m candles
STOP_LOSS_PERCENT=2        # 2% stop-loss (currently not triggering because SL wasn't being checked)
TAKE_PROFIT_PERCENT=8      # 8% take-profit
```

## How to Use Force-Close

If you have a stuck small position (like ADAUSDC):

### From FE (when button added):

- Click "Force Close" button on position card

### From API (curl):

```bash
curl -X POST http://localhost:3000/api/v1/bot/positions/{positionId}/force-close
```

Response:

```json
{
  "message": "Position force closed successfully",
  "orderId": "12345",
  "warning": "Order may have been below minNotional"
}
```

## Expected Behavior Going Forward

1. **New entries**: Only positions ≥ $15 USDT will be opened
2. **Monitoring**: Runs every 5 seconds regardless of trading enabled status
3. **Stop-losses**: Will trigger when price crosses threshold
4. **Stuck positions**: Can be manually closed via force-close endpoint

## Verification

Check logs for:

```
✅ Position closed for ADAUSDC (STOPPED_OUT): PnL -2.79 USDT (-7.79%)
⚠️  FORCE CLOSING position ... (value: 5.23 USDT)
🚫 SKIPPED BTCUSDC: Capped notional 8.50 < minimum entry 15
```

## Next Steps

Optional:

1. Add "Force Close" button to FE dashboard
2. Adjust `MIN_ENTRY_NOTIONAL` if needed (currently $15 with 20% buffer = $12 safety margin above $10 minNotional)
3. Consider adding stronger cooldown after stop-loss hits
