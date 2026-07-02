// ============================================================
// Route Aggregator — mount all route modules on the Express app
// ============================================================
const { createRateLimiter } = require('../rate-limiter');
const { createRouter: createCLIRouter } = require('./clis');
const { createRouter: createFolderRouter } = require('./folders');
const { createRouter: createUploadRouter } = require('./upload');
const { createRouter: createChatRouter } = require('./chat');
const { createRouter: createAgentRouter } = require('./agents');
const { createRouter: createWorkflowRouter } = require('./workflows');
const { createRouter: createSettingsRouter } = require('./settings');
const { createRouter: createWSTypesRouter } = require('./ws-types');
const { createRouter: createPresetsRouter } = require('./presets');
const { createRouter: createProjectRouter } = require('./project');
const { createRouter: createStockRouter } = require('./stocks');
const { createRouter: createToolsRouter } = require('./tools');
const { createRouter: createQuantRouter, setupPageRoutes } = require('./quant');

// ──────────────────────────────────────────────
// Rate limiter instances (shared across route modules)
// ──────────────────────────────────────────────
const apiLimiter = createRateLimiter({ windowMs: 60000, max: 60, message: 'API rate limit exceeded' });
const uploadLimiter = createRateLimiter({ windowMs: 60000, max: 10, message: 'Upload rate limit exceeded' });
const discoverLimiter = createRateLimiter({ windowMs: 30000, max: 3, message: 'Discovery already running, please wait' });

/**
 * Mount all API routes on the given Express application.
 *
 * @param {express.Application} app
 */
function setupRoutes(app) {
  app.use('/api', apiLimiter); // global API rate limiter

  app.use('/api', createCLIRouter({ discoverLimiter }));
  app.use('/api', createFolderRouter());
  app.use('/api', createUploadRouter({ uploadLimiter }));
  app.use('/api', createChatRouter());
  app.use('/api', createAgentRouter());
  app.use('/api', createWorkflowRouter());
app.use('/api', createSettingsRouter());
  app.use('/api', createWSTypesRouter());
  app.use('/api', createPresetsRouter());
  app.use('/api', createProjectRouter());
  app.use('/api', createStockRouter());
  app.use('/api', createToolsRouter());
  app.use('/api', createQuantRouter());
  setupPageRoutes(app);
}

module.exports = { setupRoutes };
