// ============================================================
// AI Tools Route — Terminal command execution + File I/O
// These are stateless helpers that AI agents can invoke.
// ============================================================
const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── Config ──
const WORKSPACE = process.cwd();
const MAX_OUTPUT_SIZE = 512 * 1024; // 512KB max output
const EXEC_TIMEOUT = 30000; // 30s default timeout

/**
 * Safely resolve a file path within the workspace.
 * Prevents directory traversal attacks.
 */
function safeResolve(userPath) {
  const resolved = path.resolve(WORKSPACE, userPath);
  // Ensure the resolved path is still within the workspace
  if (!resolved.startsWith(WORKSPACE)) {
    throw new Error('Path traversal denied: path must be within workspace');
  }
  return resolved;
}

/**
 * Create an Express router for AI tool endpoints.
 * @returns {express.Router}
 */
function createRouter() {
  const router = express.Router();

  // ──────────────────────────────────────────────
  // POST /api/tools/exec — Execute a terminal command
  // Body: { command, timeout?, cwd? }
  // Returns: { stdout, stderr, exitCode, duration }
  // ──────────────────────────────────────────────
  router.post('/tools/exec', async (req, res) => {
    const { command, timeout, cwd } = req.body;

    if (!command || typeof command !== 'string' || command.trim().length === 0) {
      return res.status(400).json({ error: 'command is required' });
    }

    // Safety: reject dangerous commands
    const dangerous = /(^|\s)(rm\s+-rf\s+\/|:\(\)\s*\{|:\(\)\s*\|)|dd\s+if=\/dev\/zero|mkfs\./i;
    if (dangerous.test(command)) {
      return res.status(403).json({ error: 'Command blocked: potentially dangerous operation' });
    }

    const startTime = Date.now();

    try {
      const result = await new Promise((resolve, reject) => {
        const child = exec(
          command,
          {
            cwd: cwd ? safeResolve(cwd) : WORKSPACE,
            timeout: Math.min(timeout || EXEC_TIMEOUT, 60000),
            maxBuffer: MAX_OUTPUT_SIZE,
            windowsHide: true,
          },
          (error, stdout, stderr) => {
            resolve({
              stdout: stdout || '',
              stderr: stderr || '',
              exitCode: error ? (error.code || error.status || 1) : 0,
              error: error ? error.message : null,
            });
          }
        );
      });

      const duration = Date.now() - startTime;

      return res.json({
        command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        duration,
        truncated: result.stdout.length + result.stderr.length >= MAX_OUTPUT_SIZE,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────
  // GET /api/tools/read-file — Read a file
  // Query: ?path=relative/path/to/file&encoding=utf8
  // ──────────────────────────────────────────────
  router.get('/tools/read-file', async (req, res) => {
    const filePath = req.query.path;
    const encoding = req.query.encoding || 'utf8';

    if (!filePath) {
      return res.status(400).json({ error: 'path query parameter is required' });
    }

    try {
      const resolved = safeResolve(filePath);

      // Check file exists
      if (!fs.existsSync(resolved)) {
        return res.status(404).json({ error: `File not found: ${filePath}` });
      }

      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        return res.status(400).json({ error: `Not a file: ${filePath}` });
      }

      // Size limit: 1MB for text files
      if (stat.size > 1024 * 1024) {
        return res.status(413).json({ error: 'File too large (max 1MB)' });
      }

      const content = fs.readFileSync(resolved, encoding);
      const ext = path.extname(resolved).toLowerCase();
      const language = getLanguageFromExt(ext);

      return res.json({
        path: filePath,
        resolved,
        size: stat.size,
        encoding,
        language,
        content,
      });
    } catch (err) {
      const status = err.message.includes('denied') ? 403 : 500;
      return res.status(status).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────
  // POST /api/tools/write-file — Write to a file
  // Body: { path, content, encoding? }
  // ──────────────────────────────────────────────
  router.post('/tools/write-file', async (req, res) => {
    const { path: filePath, content, encoding } = req.body;

    if (!filePath || content === undefined) {
      return res.status(400).json({ error: 'path and content are required' });
    }

    try {
      const resolved = safeResolve(filePath);

      // Ensure parent directory exists
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const enc = encoding || 'utf-8';
      fs.writeFileSync(resolved, String(content), enc);

      return res.json({
        path: filePath,
        resolved,
        size: Buffer.byteLength(String(content), enc),
        written: true,
      });
    } catch (err) {
      const status = err.message.includes('denied') ? 403 : 500;
      return res.status(status).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────
  // GET /api/tools/list-dir — List directory contents
  // Query: ?dir=relative/path&depth=1
  // ──────────────────────────────────────────────
  router.get('/tools/list-dir', async (req, res) => {
    const dirPath = req.query.dir || '.';
    const depth = Math.min(parseInt(req.query.depth) || 1, 3); // max depth 3

    try {
      const resolved = safeResolve(dirPath);

      if (!fs.existsSync(resolved)) {
        return res.status(404).json({ error: `Directory not found: ${dirPath}` });
      }

      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: `Not a directory: ${dirPath}` });
      }

      const entries = listDirRecursive(resolved, depth, 0);

      return res.json({
        path: dirPath,
        resolved,
        entries,
        total: entries.length,
      });
    } catch (err) {
      const status = err.message.includes('denied') ? 403 : 500;
      return res.status(status).json({ error: err.message });
    }
  });

  return router;
}

/**
 * Recursively list directory contents up to a max depth.
 */
function listDirRecursive(dirPath, maxDepth, currentDepth) {
  const entries = [];
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
      // Skip hidden files and node_modules
      if (item.name.startsWith('.') || item.name === 'node_modules') continue;

      const fullPath = path.join(dirPath, item.name);
      const relativePath = path.relative(WORKSPACE, fullPath);

      const entry = {
        name: item.name,
        path: relativePath,
        type: item.isDirectory() ? 'directory' : 'file',
      };

      if (item.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          entry.size = stat.size;
          entry.ext = path.extname(item.name).toLowerCase();
        } catch { /* ignore */ }
      }

      entries.push(entry);

      if (item.isDirectory() && currentDepth < maxDepth) {
        const sub = listDirRecursive(fullPath, maxDepth, currentDepth + 1);
        entries.push(...sub);
      }
    }
  } catch { /* permission denied, skip */ }
  return entries;
}

function getLanguageFromExt(ext) {
  const map = {
    '.js': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.rb': 'ruby',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.c': 'c',
    '.cpp': 'cpp',
    '.h': 'c',
    '.hpp': 'cpp',
    '.css': 'css',
    '.scss': 'scss',
    '.html': 'html',
    '.json': 'json',
    '.md': 'markdown',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.xml': 'xml',
    '.sh': 'shell',
    '.bat': 'batch',
    '.ps1': 'powershell',
    '.sql': 'sql',
    '.env': 'dotenv',
    '.gitignore': 'gitignore',
  };
  return map[ext] || 'text';
}

module.exports = { createRouter };
