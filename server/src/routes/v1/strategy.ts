import { Router } from 'express';
import {
  getActiveStrategyConfig,
  getAllStrategyConfigs,
  updateStrategyConfig,
  setActiveStrategy,
  type StrategyConfigUpdate,
} from '../../modules/db/queries/strategy_config.js';

const router = Router();

/**
 * GET /strategy - Get all strategies
 */
router.get('/', async (_req, res) => {
  try {
    const strategies = await getAllStrategyConfigs();
    res.json(strategies);
  } catch (error) {
    console.error('Error fetching strategies:', error);
    res.status(500).json({ error: 'Failed to fetch strategies' });
  }
});

/**
 * GET /strategy/active - Get active strategy configuration
 */
router.get('/active', async (_req, res) => {
  try {
    const config = await getActiveStrategyConfig();
    if (!config) {
      return res.status(404).json({ error: 'No active strategy found' });
    }
    res.json(config);
  } catch (error) {
    console.error('Error fetching active strategy:', error);
    res.status(500).json({ error: 'Failed to fetch active strategy' });
  }
});

/**
 * PUT /strategy/:name - Update strategy configuration
 */
router.put('/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const updates: StrategyConfigUpdate = req.body;

    const updated = await updateStrategyConfig(name, updates);
    if (!updated) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    res.json(updated);
  } catch (error) {
    console.error('Error updating strategy:', error);
    res.status(500).json({ error: 'Failed to update strategy' });
  }
});

/**
 * POST /strategy/:name/activate - Set a strategy as active
 */
router.post('/:name/activate', async (req, res) => {
  try {
    const { name } = req.params;
    await setActiveStrategy(name);
    res.json({ success: true, message: `Strategy '${name}' is now active` });
  } catch (error) {
    console.error('Error activating strategy:', error);
    res.status(500).json({ error: 'Failed to activate strategy' });
  }
});

export default router;
