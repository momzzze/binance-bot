import { Router } from 'express';
import type { BinanceClient } from '../../modules/exchange/binanceClient.js';

export function createBinanceRouter(binanceClient: BinanceClient | null) {
  const router = Router();

  router.get('/account', async (_req, res) => {
    if (!binanceClient) {
      res.status(503).json({ error: 'Binance client not initialized' });
      return;
    }
    const account = await binanceClient.getAccountInfo();
    res.json(account);
  });

  router.get('/ticker', async (req, res) => {
    if (!binanceClient) {
      res.status(503).json({ error: 'Binance client not initialized' });
      return;
    }
    const symbol = (req.query.symbol as string) || 'BTCUSDT';
    const ticker = await binanceClient.get24hTicker(symbol);
    res.json(ticker);
  });

  router.get('/klines', async (req, res) => {
    if (!binanceClient) {
      res.status(503).json({ error: 'Binance client not initialized' });
      return;
    }
    const symbol = (req.query.symbol as string) || 'BTCUSDT';
    const interval = (req.query.interval as string) || '1m';
    const limit = parseInt((req.query.limit as string) || '100', 10);
    const klines = await binanceClient.getKlines(symbol, interval, limit);
    res.json(klines);
  });

  return router;
}
