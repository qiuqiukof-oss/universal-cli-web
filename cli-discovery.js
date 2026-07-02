// ============================================================
// CLI Discovery — registry, PATH scanning, version/type detection
// ============================================================
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const execFile = promisify(require('child_process').execFile);
const { getActivePreset } = require('./preset-loader');

// ============================================================
// Platform helpers
// ============================================================
const isWin = process.platform === 'win32';
const REGISTRY_PATH = path.join(__dirname, 'cli-registry.json');

// ============================================================
// Preset-derived constants
// Load from preset-loader so cli-presets/*.json are the source of truth.
// Falls back to hardcoded defaults if no preset is available (legacy compat).
// ============================================================
function getPresetConstants() {
  const preset = getActivePreset();
  if (preset) {
    return {
      KNOWN_CLI_CATEGORIES: preset.categoriesMap || {},
      KNOWN_CLI_TYPES: preset.types || {},
      KNOWN_CLI_NAMES: preset.names || [],
    };
  }
  // Legacy fallback (should not happen once presets are in place)
  return {
    KNOWN_CLI_CATEGORIES: {},
    KNOWN_CLI_TYPES: {},
    KNOWN_CLI_NAMES: [],
  };
}

// ============================================================
// Version flags to try in order
// ============================================================
const VERSION_FLAGS = [
  ['--version'],
  ['-v'],
  ['-V'],
  ['version'],
];

// ============================================================
// Registry persistence
// ============================================================

/**
 * Load the CLI registry from disk.
 * Returns a default structure if the file is missing or corrupt.
 */
function loadRegistry() {
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { version: 1, clis: [] };
  }
}

/**
 * Save the CLI registry to disk.
 */
function saveRegistry(registry) {
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf-8');
}

// ============================================================
// PATH resolution
// ============================================================

/**
 * Find the full path of a command by scanning PATH directories directly.
 * No subprocess calls — pure fs operations.
 */
function resolveCommand(name) {
  const exts = isWin
    ? (process.env.PATHEXT || '.exe;.cmd;.bat;.com').split(';').map(e => e.toLowerCase())
    : [''];
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);

  for (const dir of pathDirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch { /* not found */ }
    }
  }
  return null;
}

// ============================================================
// Version detection
// ============================================================

/**
 * Safely get version string — async, non-blocking.
 * Uses execFile (no shell injection), tries multiple flags,
 * captures both stdout/stderr, and cleans null bytes from output.
 * Handles encoding issues (e.g., Chinese characters on Windows).
 */
async function getVersion(fullPath) {
  for (const flags of VERSION_FLAGS) {
    try {
      const { stdout, stderr } = await execFile(fullPath, flags, {
        encoding: 'utf-8',
        timeout: 2000,
        windowsHide: true,
      });
      const cleaned = (stdout || stderr || '')
        .replace(/\0/g, '')          // Remove null bytes
        .replace(/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') // Remove replacement chars & control chars
        .trim()
        .split(/\r?\n/)[0];
      if (cleaned && cleaned.length > 0) return cleaned;
    } catch {
      // try next flag — timeout, exec error, etc.
    }
  }
  return 'unknown';
}

// ============================================================
// Type classification
// ============================================================

/**
 * Get the category for a CLI name.
 */
function guessCategory(name) {
  const { KNOWN_CLI_CATEGORIES } = getPresetConstants();
  return KNOWN_CLI_CATEGORIES[name] || 'tool';
}

/**
 * Determine if a command is interactive or batch — async, non-blocking.
 * Uses known type map first, then falls back to --help heuristic.
 */
async function guessType(fullPath, name) {
  const { KNOWN_CLI_TYPES } = getPresetConstants();
  // Check known types first — authoritative
  if (KNOWN_CLI_TYPES[name] !== undefined) {
    return KNOWN_CLI_TYPES[name];
  }

  // Fallback: run --help, if it exits quickly it's batch
  try {
    await execFile(fullPath, ['--help'], {
      timeout: 2000,
      windowsHide: true,
    });
    return 'batch';
  } catch {
    return 'interactive';
  }
}

// ============================================================
// Discovery orchestrator
// ============================================================

/**
 * Discover CLIs from PATH — async, non-blocking.
 * Runs all version/type checks in parallel using Promise.allSettled.
 */
async function discoverCLIs() {
  const registry = loadRegistry();
  // Preserve only manually-added CLIs; remove auto-discovered ones
  // so switching presets actually switches the tool set
  const manualCLIs = registry.clis.filter(c => c.discovered === 'manual');
  registry.clis = manualCLIs;
  const existingIds = new Set(manualCLIs.map(c => c.id));
  const { KNOWN_CLI_NAMES } = getPresetConstants();

  // First pass — collect all candidates synchronously (fast, no subprocess)
  const candidates = [];
  for (const name of KNOWN_CLI_NAMES) {
    if (existingIds.has(name)) continue;
    const fullPath = resolveCommand(name);
    if (!fullPath) continue;
    let stat;
    try { stat = fs.statSync(fullPath); } catch { continue; }
    if (stat.size === 0) continue;
    candidates.push({ name, fullPath });
  }

  if (candidates.length === 0) {
    return { registry, discovered: [] };
  }

  // Second pass — run all version/type checks in parallel (non-blocking)
  const results = await Promise.allSettled(
    candidates.map(async ({ name, fullPath }) => {
      const [version, type] = await Promise.all([
        getVersion(fullPath),
        guessType(fullPath, name),
      ]);
      return {
        id: name,
        name,
        path: fullPath,
        type,
        category: guessCategory(name),
        discovered: 'path',
        args: [],
        version,
        addedAt: new Date().toISOString(),
      };
    })
  );

  const discovered = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      discovered.push(result.value);
      existingIds.add(result.value.id);
    }
  }

  if (discovered.length > 0) {
    registry.clis.push(...discovered);
    saveRegistry(registry);
  }

  return { registry, discovered };
}

/**
 * Discover CLIs asynchronously — safe wrapper.
 */
async function discoverCLIsAsync() {
  try {
    return await discoverCLIs();
  } catch (e) {
    return { registry: loadRegistry(), discovered: [] };
  }
}

// ============================================================
// Registry migration — resolve non-absolute paths on startup
// ============================================================

/**
 * Resolve all non-absolute CLI paths in the registry using PATH.
 * This fixes entries like `opencode` (no path) to their real absolute path.
 */
function resolveRegistryPaths() {
  const registry = loadRegistry();
  let changed = false;

  for (const cli of registry.clis) {
    if (!cli.path || path.isAbsolute(cli.path)) continue;

    const resolved = resolveCommand(cli.name);
    if (resolved && resolved !== cli.path) {
      cli.path = resolved;
      changed = true;
      console.log(`[Registry] Resolved "${cli.name}" → ${resolved}`);
    }
  }

  if (changed) {
    saveRegistry(registry);
  }
  return registry;
}

/**
 * Migrate registry entries that are missing a category field.
 * Assigns categories based on KNOWN_CLI_CATEGORIES or defaults to 'tool'.
 */
function migrateRegistryCategories() {
  const registry = loadRegistry();
  let changed = false;

  for (const cli of registry.clis) {
    if (!cli.category) {
      cli.category = guessCategory(cli.name);
      changed = true;
      console.log(`[Registry] Assigned category "${cli.category}" to "${cli.name}"`);
    }
  }

  if (changed) {
    saveRegistry(registry);
  }
  return registry;
}

// ============================================================
// Registry write serialization (prevents async interleaving)
// ============================================================

let registryWriteQueue = Promise.resolve();
const MAX_QUEUE_LENGTH = 50;
let queueLength = 0;

/**
 * Execute a function that reads and writes the registry.
 * Operations are queued to prevent interleaved async writes.
 * If the queue exceeds MAX_QUEUE_LENGTH, the operation is rejected
 * to prevent unbounded memory growth.
 */
async function withRegistry(fn) {
  if (queueLength >= MAX_QUEUE_LENGTH) {
    console.warn('[Registry] Write queue full, rejecting operation');
    const err = new Error('Registry write queue full, try again');
    err.status = 503;
    throw err;
  }
  queueLength++;
  const prev = registryWriteQueue;
  const next = prev.then(fn, fn); // run even if previous failed
  registryWriteQueue = next.then(
    () => { queueLength--; },
    () => { queueLength--; }
  );
  return next;
}

// ============================================================
// Exports
// ============================================================
module.exports = {
  // Expose preset getter for other modules
  getPresetConstants,
  // Constants
  VERSION_FLAGS,
  REGISTRY_PATH,
  isWin,
  // Registry
  loadRegistry,
  saveRegistry,
  withRegistry,
  resolveRegistryPaths,
  migrateRegistryCategories,
  // Resolution
  resolveCommand,
  // Detection
  getVersion,
  guessType,
  guessCategory,
  // Discovery
  discoverCLIsAsync,
};
