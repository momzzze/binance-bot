import { Router } from 'express';
import { query } from '../../modules/db/db.js';
import { loadEnv } from '../../config/env.js';

const config = loadEnv();
const router = Router();

router.get('/health', async (_req, res) => {
  await query('SELECT 1 as ok');
  res.json({
    status: 'ok',
    db: 'ok',
    tradingEnabled: config.TRADING_ENABLED,
    killSwitch: config.BOT_KILL_SWITCH,
  });
});

export default router;
