import { Router } from 'express';
import { getCandles, insertCandles } from '../../modules/db/queries/candles.js';
import { fetchCandles } from '../../modules/market/marketData.js';

const router = Router();

/**
 * GET /candles/:symbol - Get candlestick data for charting
 * Query params:
 *   - interval: '1m', '5m', '15m', '1h', '4h', '1d' (required)
 *   - startTime: Unix timestamp in ms (optional)
 *   - endTime: Unix timestamp in ms (optional)
 *   - limit: Number of candles (default 500, max 1000)
 */
router.get('/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { interval, startTime, endTime, limit } = req.query;

    if (!interval) {
      return res.status(400).json({ error: 'interval query parameter is required' });
    }

    const parsedLimit = limit ? Math.min(parseInt(limit as string), 1000) : 500;
    const parsedStartTime = startTime ? parseInt(startTime as string) : undefined;
    const parsedEndTime = endTime ? parseInt(endTime as string) : undefined;

    // Try to get from database first
    let candles = await getCandles(
      symbol.toUpperCase(),
      interval as string,
      parsedStartTime,
      parsedEndTime,
      parsedLimit
    );

    // If no candles in DB, fetch from Binance and store
    if (candles.length === 0) {
      const binanceClient = req.app.locals.binanceClient;
      if (!binanceClient) {
        return res.status(503).json({ error: 'Binance client not available' });
      }

      const freshCandles = await fetchCandles(
        binanceClient,
        symbol.toUpperCase(),
        interval as string,
        parsedLimit
      );

      // Store in database for future use
      if (freshCandles.length > 0) {
        // Validate candles: calculate price mean and std dev
        const prices = freshCandles.map((c: any) => parseFloat(c.close));
        const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
        const stdDev = Math.sqrt(
          prices.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / prices.length
        );

        // Only insert valid candles (within 3 std dev from mean - more lenient than chart filtering)
        const candlesToInsert = freshCandles
          .filter((c: any) => {
            const closePrice = parseFloat(c.close);
            const zScore = Math.abs((closePrice - mean) / stdDev);
            return zScore <= 3; // Keep candles within 3 std dev
          })
          .map((c: any) => ({
            symbol: symbol.toUpperCase(),
            interval: interval as string,
            open_time: c.openTime.toString(),
            open: c.open.toString(),
            high: c.high.toString(),
            low: c.low.toString(),
            close: c.close.toString(),
            volume: c.volume.toString(),
            close_time: c.closeTime.toString(),
            quote_asset_volume: c.quoteAssetVolume?.toString(),
            number_of_trades: c.numberOfTrades,
            taker_buy_base_asset_volume: c.takerBuyBaseAssetVolume?.toString(),
            taker_buy_quote_asset_volume: c.takerBuyQuoteAssetVolume?.toString(),
          }));

        if (candlesToInsert.length > 0) {
          await insertCandles(candlesToInsert);
        }

        // Fetch from DB to get IDs and created_at
        candles = await getCandles(
          symbol.toUpperCase(),
          interval as string,
          undefined,
          undefined,
          parsedLimit
        );
      }
    }

    res.json(candles);
  } catch (error) {
    console.error('Error fetching candles:', error);
    res.status(500).json({ error: 'Failed to fetch candles' });
  }
});

export default router;
