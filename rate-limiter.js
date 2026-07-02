// ============================================================
// Simple in-memory rate limiter (no external dependency)
// ============================================================

/**
 * Create an Express-compatible rate limiting middleware.
 *
 * @param {object} options
 * @param {number} [options.windowMs=60000]  Time window in milliseconds
 * @param {number} [options.max=30]           Max requests per window
 * @param {string} [options.message]          Error message on block
 * @returns {function} Express middleware
 */
function createRateLimiter({ windowMs = 60000, max = 30, message = 'Too many requests, please slow down' } = {}) {
  const hits = new Map();

  // Periodically sweep stale entries — also limit total map size to 10k
  const MAX_MAP_SIZE = 10000;
  const cleanup = setInterval(() => {
    const now = Date.now();
    // Remove all entries whose window has expired
    for (const [key, entry] of hits) {
      if (now - entry.time > windowMs) hits.delete(key);
    }
    // If still too large, trim oldest 20%
    if (hits.size > MAX_MAP_SIZE) {
      const entries = [...hits.entries()].sort((a, b) => a[1].time - b[1].time);
      const removeCount = Math.floor(hits.size * 0.2);
      for (let i = 0; i < removeCount; i++) {
        hits.delete(entries[i][0]);
      }
    }
  }, 60000);
  if (cleanup.unref) cleanup.unref();

  return function rateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = hits.get(ip);

    if (!entry || now - entry.time > windowMs) {
      // First request or window expired — reset
      hits.set(ip, { count: 1, time: now });
      return next();
    }

    entry.count++;
    entry.time = now;

    if (entry.count > max) {
      return res.status(429).json({ error: message });
    }
    next();
  };
}

module.exports = { createRateLimiter };
