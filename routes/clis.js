// ============================================================
// CLI CRUD Routes
// ============================================================
const express = require('express');
const {
  loadRegistry,
  saveRegistry,
  withRegistry,
  resolveCommand,
  getVersion,
  guessType,
  guessCategory,
  discoverCLIsAsync,
} = require('../cli-discovery');

/**
 * Create an Express router for CLI CRUD operations.
 *
 * @param {{ discoverLimiter: Function }} rateLimiters
 * @returns {express.Router}
 */
function createRouter({ discoverLimiter }) {
  const router = express.Router();

  // ──────────────────────────────────────────────
  // List all registered CLIs
  // ──────────────────────────────────────────────
  router.get('/clis', (req, res) => {
    const registry = loadRegistry();
    // Folders are stored inside cli-registry.json as registry.folders
    res.json({ ...registry, folders: registry.folders || [] });
  });

  // ──────────────────────────────────────────────
  // Add a CLI manually
  // ──────────────────────────────────────────────
  router.post('/clis', async (req, res) => {
    const { name, path: cliPath, args, init } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    // Validate args type and content
    if (args !== undefined) {
      if (!Array.isArray(args) || !args.every(a => typeof a === 'string')) {
        return res.status(400).json({ error: 'args must be an array of strings' });
      }
    }

    const fullPath = cliPath || resolveCommand(name);
    if (!fullPath) {
      return res.status(400).json({ error: `Cannot resolve "${name}" in PATH` });
    }

    // Validate the provided path to prevent command injection
    if (cliPath) {
      if (!path.isAbsolute(cliPath)) {
        return res.status(400).json({ error: 'path must be an absolute path' });
      }
      try {
        if (!fs.statSync(cliPath).isFile()) {
          return res.status(400).json({ error: 'path does not point to a valid file' });
        }
      } catch {
        return res.status(400).json({ error: 'path is not accessible' });
      }
    }

    // Resolve version, type, and category in parallel
    const [version, type] = await Promise.all([
      getVersion(fullPath),
      guessType(fullPath, name),
    ]);
    const category = guessCategory(name);

    // Use withRegistry for atomic read-modify-write
    let entry;
    try {
      entry = await withRegistry(() => {
        const reg = loadRegistry();
        const id = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

        if (reg.clis.some(c => c.id === id)) {
          const err = new Error(`CLI "${id}" already registered`);
          err.status = 409;
          throw err;
        }

        const newEntry = {
          id,
          name,
          path: fullPath,
          type,
          category,
          discovered: 'manual',
          args: args || [],
          init: init || '',
          version,
          addedAt: new Date().toISOString(),
        };

        reg.clis.push(newEntry);
        saveRegistry(reg);
        return newEntry;
      });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({ error: err.message });
    }

    res.status(201).json(entry);
  });

  // ──────────────────────────────────────────────
  // Remove a CLI
  // ──────────────────────────────────────────────
  router.delete('/clis/:id', async (req, res) => {
    try {
      const result = await withRegistry(() => {
        const registry = loadRegistry();
        const idx = registry.clis.findIndex(c => c.id === req.params.id);
        if (idx === -1) {
          const err = new Error('CLI not found');
          err.status = 404;
          throw err;
        }
        registry.clis.splice(idx, 1);
        saveRegistry(registry);
        return { success: true };
      });
      res.json(result);
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────
  // Run discovery
  // ──────────────────────────────────────────────
  router.post('/discover', discoverLimiter, async (req, res) => {
    try {
      const result = await discoverCLIsAsync();
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createRouter };
