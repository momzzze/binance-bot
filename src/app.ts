import { loadEnv } from './config/env.js';
import { createLogger } from './services/logger.js';

const logger = createLogger();
const config = loadEnv();

async function main() {
  logger.info(
    `Starting Binance Bot (tradingEnabled=${config.TRADING_ENABLED}, killSwitch=${config.BOT_KILL_SWITCH})`
  );
  logger.info(`Symbols: ${config.SYMBOLS.join(', ')}`);
  // TODO: Wire runner in next steps
}

main().catch((err) => {
  logger.error('Fatal error starting bot', err);
  process.exit(1);
});
