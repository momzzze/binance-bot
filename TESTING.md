# Binance Bot REST API Testing Guide

## Overview

This guide explains how to test the Binance REST API integration using Postman and the local development server.

## Prerequisites

1. Server running: `pnpm dev` (should show "HTTP server listening on port 3000")
2. Binance Testnet API keys configured in `.env`
3. Postman installed and collection imported

## Available Endpoints

### 1. Health Check

**Endpoint:** `GET /health`  
**Purpose:** Check server, database, and bot status  
**Auth:** None  
**Example Response:**

```json
{
  "status": "ok",
  "db": "ok",
  "tradingEnabled": false,
  "killSwitch": false
}
```

### 2. Binance Account Info

**Endpoint:** `GET /api/binance/account`  
**Purpose:** Get testnet account balances and permissions  
**Auth:** Binance API keys from `.env`  
**Example Response:**

```json
{
  "makerCommission": 10,
  "takerCommission": 10,
  "canTrade": true,
  "balances": [
    {
      "asset": "BTC",
      "free": "1000.00000000",
      "locked": "0.00000000"
    },
    {
      "asset": "USDT",
      "free": "10000.00000000",
      "locked": "0.00000000"
    }
  ]
}
```

### 3. 24h Ticker Price

**Endpoint:** `GET /api/binance/ticker?symbol=BTCUSDT`  
**Purpose:** Get 24-hour price statistics for a symbol  
**Auth:** None (public endpoint)  
**Query Params:**

- `symbol` (optional, default: BTCUSDT) - Trading pair

**Example Response:**

```json
{
  "symbol": "BTCUSDT",
  "lastPrice": "42150.50",
  "priceChange": "850.20",
  "priceChangePercent": "2.06",
  "highPrice": "42500.00",
  "lowPrice": "41000.00",
  "volume": "12345.67"
}
```

### 4. Klines (Candlestick Data)

**Endpoint:** `GET /api/binance/klines?symbol=BTCUSDT&interval=1m&limit=10`  
**Purpose:** Get historical candlestick/kline data  
**Auth:** None (public endpoint)  
**Query Params:**

- `symbol` (optional, default: BTCUSDT) - Trading pair
- `interval` (optional, default: 1m) - Time interval (1m, 5m, 15m, 1h, 4h, 1d)
- `limit` (optional, default: 100) - Number of candles (max 1000)

**Example Response:**

```json
[
  {
    "openTime": 1705012800000,
    "open": "42100.50",
    "high": "42200.00",
    "low": "42050.00",
    "close": "42150.50",
    "volume": "123.45",
    "closeTime": 1705012859999,
    "numberOfTrades": 456
  }
]
```

## Testing with Postman

### Step 1: Import Collection

1. Open Postman
2. Click **Import** → Select `postman.collection.json`
3. Collection "Binance Bot Local" appears in sidebar

### Step 2: Verify Server

1. Run: **Health** request
2. Should return `200 OK` with status info
3. If error: check if `pnpm dev` is running

### Step 3: Test Public Endpoints

1. Run: **Binance 24h Ticker** (BTCUSDT)
2. Run: **Binance 24h Ticker - ETHUSDT**
3. Run: **Binance Klines (Candles)**
4. All should return `200 OK` with market data from testnet

### Step 4: Test Authenticated Endpoint

1. Ensure `.env` has valid testnet API keys
2. Run: **Binance Account Info**
3. Should return `200 OK` with testnet balances
4. If `503`: API keys missing or invalid

## Common Issues

### Error: "Binance client not initialized"

- **Cause:** Missing or empty `BINANCE_API_KEY` or `BINANCE_API_SECRET` in `.env`
- **Fix:** Add valid testnet keys from https://testnet.binance.vision/

### Error: "listen EADDRINUSE"

- **Cause:** Port 3000 already in use
- **Fix:** Stop other node processes or change `PORT` in `.env`

### Error: Signature verification failed

- **Cause:** Server time offset or invalid secret
- **Fix:** Check server logs for time sync; verify secret is correct

### Error: Rate limit exceeded

- **Cause:** Too many requests to Binance API
- **Fix:** Wait 1 minute; client has built-in retry logic

## Direct Testing with curl

```bash
# Health check
curl http://localhost:3000/api/health

# Get ticker
curl "http://localhost:3000/api/binance/ticker?symbol=BTCUSDT"

# Get candles
curl "http://localhost:3000/api/binance/klines?symbol=BTCUSDT&interval=1m&limit=5"

# Get account (requires API keys in .env)
curl http://localhost:3000/api/binance/account

# Bot status
curl http://localhost:3000/api/bot/status

# Start bot (POST request)
curl -X POST http://localhost:3000/api/bot/start

# Stop bot (POST request)
curl -X POST http://localhost:3000/api/bot/stop
```

## Bot Control Endpoints

### GET /api/bot/status

Returns current bot status including:

- `running`: Whether bot loop is active
- `symbols`: List of symbols being traded
- `loopMs`: Loop interval in milliseconds
- `tradingEnabled`: Trading flag from config
- `killSwitch`: Kill switch flag from config

### POST /api/bot/start

Starts the trading bot loop. The bot will:

1. Fetch candles for all configured symbols
2. Compute trading signals using SMA, EMA, and RSI indicators
3. Check risk limits (kill switch, max orders, max order value)
4. Execute BUY/SELL orders (if trading is enabled)
5. Sleep for LOOP_MS and repeat

**Note:** By default, `TRADING_ENABLED=false` in your `.env` to prevent accidental trades. Set it to `true` to enable real order placement.

### POST /api/bot/stop

Gracefully stops the bot loop. Current iteration will complete before stopping.

## Bot Trading Strategy

The bot uses a simple technical analysis strategy:

**Indicators:**

- SMA20 and SMA50 (Simple Moving Averages)
- EMA12 and EMA26 (Exponential Moving Averages)
- RSI14 (Relative Strength Index)

**BUY Signals:**

- SMA20 > SMA50 (bullish trend) → +3 points
- EMA12 > EMA26 (short-term momentum) → +2 points
- RSI < 30 (oversold) → +2 points
- RSI < 50 → +1 point

**SELL Signals:**

- SMA20 < SMA50 (bearish trend) → -3 points
- EMA12 < EMA26 (short-term weakness) → -2 points
- RSI > 70 (overbought) → -2 points
- RSI > 50 → -1 point

**Decision:**

- Score ≥ 4: BUY signal
- Score ≤ -4: SELL signal
- Otherwise: HOLD (no action)

## Risk Management

Before executing any order, the bot checks:

1. **Kill Switch**: `BOT_KILL_SWITCH` must be `false`
2. **Trading Enabled**: `TRADING_ENABLED` must be `true`
3. **Max Order Value**: Order value must not exceed `MAX_ORDER_USDT`
4. **Max Open Orders**: Symbol must have < `MAX_OPEN_ORDERS_PER_SYMBOL` open orders

Orders are rejected if any check fails.

## Next Steps

Once REST API and bot control tests pass:

1. ✅ Market data module with multi-symbol candles
2. ✅ Simple trading strategy with SMA/EMA/RSI
3. ✅ Risk engine for order validation
4. ✅ Executor to place/track orders
5. ✅ Bot runner loop
6. Test bot with `TRADING_ENABLED=false` (paper trading mode)
7. Monitor logs and verify signals
8. Enable trading on testnet with `TRADING_ENABLED=true`

## Logs to Watch

```
[INFO] [BinanceClient] Server time offset: 244ms  ← Time sync OK
[DEBUG] [BinanceClient] GET /api/v3/time           ← Public request
[DEBUG] [BinanceClient] GET /api/v3/account        ← Signed request
[INFO] [runner] 🤖 Bot started - watching 2 symbols ← Bot started
[INFO] [market] Fetching candles for 2 symbols    ← Market data
[INFO] [strategy] BTCUSDT: BUY (score=5)           ← Trading signal
[INFO] [executor] ✓ Buy order placed               ← Order executed
```

Green `ℹ INFO` = success  
Yellow `⚠ WARN` = warning (keys missing)  
Red `✖ ERROR` = failure

## Notes

- **Testnet** = fake money, safe for testing
- All prices/balances are simulated
- No real funds at risk
- Perfect for development and strategy testing
- **Paper Trading Mode**: Keep `TRADING_ENABLED=false` to see signals without placing orders

## Trade Analytics API

Once the bot is running and executing trades, you can analyze performance via these endpoints:

### Get All Trades

```bash
curl "http://localhost:3000/api/trades?limit=50"
curl "http://localhost:3000/api/trades?symbol=BTCUSDT&side=BUY"
```

Returns executed orders with filters for symbol, side, limit, and offset.

### Get Trading Statistics

```bash
curl "http://localhost:3000/api/trades/stats"
curl "http://localhost:3000/api/trades/stats?symbol=BTCUSDT"
```

Returns:

- Total orders placed
- BUY vs SELL count
- Total quantity filled
- Filled vs canceled count

### Get Trading Signals

```bash
curl "http://localhost:3000/api/trades/signals?symbol=BTCUSDT&limit=20"
```

Returns recent trading signals with:

- Signal type (BUY/SELL/HOLD)
- Score and indicators (SMA, EMA, RSI)
- Reason for the signal
- Timestamp

### Get Trading Summary

```bash
curl "http://localhost:3000/api/trades/summary"
```

Returns overall trading statistics across all symbols.

All trade data is persisted to the PostgreSQL database in the `orders` and `decisions` tables for offline analysis.
