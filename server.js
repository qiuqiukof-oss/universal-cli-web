// ============================================================
// Universal CLI Bridge — Entry Point
// ============================================================
const express = require('express');
const http = require('http');
const path = require('path');
const { setupRoutes } = require('./routes');
const { setupWebSocket } = require('./ws-handler');
const { discoverCLIsAsync, resolveRegistryPaths, migrateRegistryCategories } = require('./cli-discovery');
const { cleanupOldUploads } = require('./routes/upload');

// node-pty may fork conpty_console_list_agent which can fail on some Windows
// configurations. We catch unhandled rejections to prevent crashing the server.
process.on('unhandledRejection', (reason) => {
  console.error('[PTY] Unhandled rejection (non-fatal):', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
  console.error(err.stack);
  process.exit(1); // Process is corrupted — exit so process manager (pm2/docker) can restart
});

// ============================================================
// Configuration
// ============================================================
const PORT = parseInt(process.env.PORT, 10) || 3001;
const HOST = process.env.HOST || '127.0.0.1';
const isWin = process.platform === 'win32';

// ============================================================
// Express App
// ============================================================
const app = express();
app.use(express.json({ limit: '1mb' }));

// Serve xterm.js from node_modules
app.use('/xterm', express.static(path.join(__dirname, 'node_modules', '@xterm', 'xterm')));
app.use('/xterm-addon-fit', express.static(path.join(__dirname, 'node_modules', '@xterm', 'addon-fit')));
app.use('/xterm-addon-web-links', express.static(path.join(__dirname, 'node_modules', '@xterm', 'addon-web-links')));
app.use('/xterm-addon-webgl', express.static(path.join(__dirname, 'node_modules', '@xterm', 'addon-webgl')));
app.use('/xterm-addon-search', express.static(path.join(__dirname, 'node_modules', '@xterm', 'addon-search')));

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Mount all API routes
setupRoutes(app);

// ============================================================
// HTTP Server + WebSocket
// ============================================================
const server = http.createServer(app);
const wsManager = setupWebSocket(server, { port: PORT });

// ============================================================
// Start
// ============================================================
server.listen(PORT, HOST, () => {
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Q-CLI 集成器 v0.2.0`);
  console.log(`  → http://${HOST}:${PORT}`);
  console.log(`  → WebSocket  : ws://${HOST}:${PORT}`);
  console.log(`  → PID        : ${process.pid}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Platform: ${process.platform} | Node ${process.version}`);
  console.log(`Uploads  : TTL 1 hour`);

  // Run initial cleanup on start
  cleanupOldUploads();

  // Cold start optimization: delay CLI discovery 500ms so browser connects first
  setTimeout(() => {
    // Resolve non-absolute CLI paths (e.g., 'opencode' → full path)
    resolveRegistryPaths();

    // Assign categories to any entries that are missing them
    migrateRegistryCategories();

    // Auto-discover CLIs in background
    discoverCLIsAsync().then(result => {
      const total = result.registry.clis.length;
      const newClis = result.discovered.length;
      console.log(`CLIs     : ${total} registered (${newClis} new)`);
    }).catch(e => {
      console.log(`CLIs     : discovery error (${e.message})`);
    });
  }, 500);
});

// ============================================================
// Graceful shutdown
// ============================================================
function shutdown() {
  console.log('\nShutting down...');
  wsManager.close();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
