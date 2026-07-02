// ============================================================
// Presets API — list and activate CLI presets
// ============================================================
const { Router } = require('express');
const {
  listPresets,
  getActivePreset,
  getActivePresetName,
  setActivePreset,
  resolvePreset,
} = require('../preset-loader');

/**
 * Create the presets router.
 */
function createRouter() {
  const router = Router();

  /**
   * GET /api/presets
   * List all available presets and the currently active one.
   */
  router.get('/presets', (_req, res) => {
    const presets = listPresets();
    const activePreset = getActivePresetName();
    const activePresetData = resolvePreset(activePreset);
    res.json({
      presets,
      active: activePreset,
      categories: activePresetData ? activePresetData.categories : {},
      welcome: activePresetData ? activePresetData.welcome : null,
    });
  });

  /**
   * POST /api/presets/activate
   * Switch to a different preset.
   * Body: { name: "developer" | "media-engineer" }
   */
  router.post('/presets/activate', (req, res) => {
    const { name } = req.body || {};
    if (!name) {
      return res.status(400).json({ error: 'Preset name is required' });
    }
    const success = setActivePreset(name);
    if (!success) {
      return res.status(404).json({ error: `Preset "${name}" not found` });
    }
    const presetData = resolvePreset(name);
    res.json({
      active: name,
      categories: presetData ? presetData.categories : {},
      welcome: presetData ? presetData.welcome : null,
    });
  });

  return router;
}

module.exports = { createRouter };
