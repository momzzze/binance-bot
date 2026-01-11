import { Router } from 'express';
import type { BinanceClient } from '../../modules/exchange/binanceClient.js';
import type { BotConfig } from '../../config/env.js';
import {
  runBot,
  stopBot,
  isBotRunning,
  getCurrentSymbols,
  getSymbolSource,
} from '../../modules/runner/botRunner.js';
import { createLogger } from '../../services/logger.js';

const log = createLogger('routes/bot');

export function createBotRouter(binanceClient: BinanceClient | null, config: BotConfig): Router {
  const router = Router();

  /**
   * GET /bot/status - Get bot running status
   */
  router.get('/status', (req, res) => {
    res.json({
      running: isBotRunning(),
      symbols: getCurrentSymbols().length > 0 ? getCurrentSymbols() : config.SYMBOLS,
      symbolSource: getSymbolSource(),
      loopMs: config.LOOP_MS,
      tradingEnabled: config.TRADING_ENABLED,
      killSwitch: config.BOT_KILL_SWITCH,
    });
  });

  /**
   * POST /bot/start - Start the bot
   */
  router.post('/start', async (req, res) => {
    if (!binanceClient) {
      return res.status(503).json({ error: 'Binance client not configured' });
    }

    if (isBotRunning()) {
      return res.status(400).json({ error: 'Bot is already running' });
    }

    try {
      // Start bot in background (non-blocking)
      runBot(binanceClient, config).catch((err) => {
        log.error('Bot crashed:', err);
      });

      res.json({ message: 'Bot started successfully', running: true });
    } catch (error) {
      log.error('Failed to start bot:', error);
      res.status(500).json({ error: 'Failed to start bot' });
    }
  });

  /**
   * POST /bot/stop - Stop the bot
   */
  router.post('/stop', (req, res) => {
    if (!isBotRunning()) {
      return res.status(400).json({ error: 'Bot is not running' });
    }

    stopBot();
    res.json({ message: 'Bot stop signal sent', running: false });
  });

  return router;
}
