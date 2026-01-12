# Binance Trading Bot 🤖

A full-stack TypeScript trading bot with real-time React dashboard for Binance futures trading with advanced risk management.

## Project Structure

```
binance-bot/
├── server/              # Node.js/Express backend
│   ├── src/
│   │   ├── app.ts
│   │   ├── config/
│   │   ├── modules/
│   │   ├── routes/
│   │   ├── services/
│   │   └── utils/
│   ├── package.json
│   └── tsconfig.json
│
├── client/              # React/TypeScript frontend
│   ├── src/
│   │   ├── components/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── index.scss
│   │   └── App.scss
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
└── package.json         # Root monorepo config
```

## Features

### Backend (Server)
- ✅ Binance API integration (testnet & live)
- ✅ Real-time market data & technical analysis
- ✅ Automated order execution with filters
- ✅ Position monitoring with trailing stops
- ✅ PostgreSQL database for persistence
- ✅ Stop loss & take profit management
- ✅ Risk management (percentage-based sizing)
- ✅ Auto-balance replenishment

### Frontend (Client)
- 💼 **Portfolio Overview** - Total balance, PnL, win rate
- 📊 **Open Positions** - Real-time position tracking
- 📈 **Trade History** - Complete trade log with filters
- ⚙️ **Bot Control** - Start/stop trading, view configuration
- 🎨 **Dark theme UI** - Professional trading dashboard

## Setup

### Prerequisites
- Node.js ≥ 20
- PostgreSQL 13+
- pnpm (or npm/yarn)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/binance-bot.git
cd binance-bot

# Install root dependencies
pnpm install

# Install server dependencies
cd server && pnpm install && cd ..

# Install client dependencies
cd client && pnpm install && cd ..
```

### Environment Setup

Create `.env` in the `server/` directory:

```env
# Database
POSTGRES_URL="postgres://user:password@localhost:5432/binance_bot"

# Binance API
BINANCE_BASE_URL="https://testnet.binance.vision"
BINANCE_API_KEY="your_api_key"
BINANCE_API_SECRET="your_api_secret"

# Trading Config
STRATEGY="marketcap"
SYMBOLS="BTCUSDT,ETHUSDT"
INTERVAL="1m"
TRADING_ENABLED=true
MAX_OPEN_ORDERS_PER_SYMBOL=5

# Risk Management
RISK_PER_TRADE_PERCENT=1
STOP_LOSS_PERCENT=2
TAKE_PROFIT_PERCENT=8
TRAILING_STOP_ENABLED=true

# Logging
LOG_LEVEL=info
```

## Running

### Development (Server + Client)
```bash
pnpm dev
```

This starts:
- Backend: `http://localhost:3000` (API)
- Frontend: `http://localhost:3001` (Dashboard)

### Individual Commands
```bash
# Server only
pnpm server:dev

# Client only
pnpm client:dev
```

### Build for Production
```bash
pnpm build
```

## API Endpoints

### Health Check
- `GET /health` - API status

### Bot Status
- `GET /bot/status` - Bot running state, symbols, config
- `POST /bot/start` - Start trading
- `POST /bot/stop` - Stop trading

### Trading Data
- `GET /trades` - All orders with filters
- `GET /trades/stats` - Trading statistics
- `GET /trades/summary` - Portfolio summary
- `GET /trades/signals` - Recent strategy signals

## Technology Stack

### Backend
- **Runtime**: Node.js + TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL
- **APIs**: Binance REST API
- **Logging**: Custom logger with levels

### Frontend
- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite
- **Styling**: SASS/SCSS
- **HTTP**: Axios

## Features in Detail

### Risk Management
- Percentage-based position sizing (1% risk per trade)
- Stop loss (-2%) and take profit (+8%) levels
- Trailing stop to lock in profits
- Maximum position limits per symbol
- Automatic balance replenishment

### Strategy
- Market cap-based technical analysis
- Volume surge detection
- EMA crossovers
- RSI overbought/oversold signals

### Database
- Order history tracking
- Position monitoring
- Trading decisions logging
- Performance analytics

## Monitoring & Logging

View bot logs with different levels:
- `LOG_LEVEL=debug` - All messages
- `LOG_LEVEL=info` - Important events only
- `LOG_LEVEL=warn` - Warnings and errors
- `LOG_LEVEL=error` - Errors only

## Next Steps

1. Configure your Binance API keys
2. Set up PostgreSQL database
3. Run migrations: `pnpm server:db:migrate`
4. Start the bot: `pnpm dev`
5. Open dashboard: `http://localhost:3001`

## License

MIT

## Disclaimer

Trading cryptocurrencies is highly risky. Use this bot responsibly with proper risk management. Always test on testnet first.
