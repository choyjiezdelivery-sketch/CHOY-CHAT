'use strict';

/**
 * Production hardening middleware.
 *
 * Deliberately dependency-free: a small in-memory rate limiter and a set of
 * security headers. Both are safe defaults that do not change behaviour in
 * development, so the test suite runs against the same code path as production.
 */

/* ------------------------------------------------------------ rate limiter */

/**
 * Fixed-window rate limiter keyed by client IP.
 *
 * A fixed window is used rather than a sliding log because it is O(1) per
 * request and bounded in memory: one counter per key per window, swept when the
 * window rolls over. That is plenty for protecting login and registration from
 * credential stuffing, which is what this is for.
 *
 * @param {object} opts
 * @param {number} opts.windowMs  window length in milliseconds
 * @param {number} opts.max       allowed requests per window per key
 * @param {string} [opts.message] error message returned on 429
 */
function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  let windowStart = Date.now();

  function sweep(now) {
    if (now - windowStart < windowMs) return;
    hits.clear();
    windowStart = now;
  }

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    sweep(now);

    // req.ip is correct behind a proxy only when `trust proxy` is set, which
    // server.js does for production. Fall back to the socket address.
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const count = (hits.get(key) || 0) + 1;
    hits.set(key, count);

    const remaining = Math.max(0, max - count);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil((windowStart + windowMs - now) / 1000)));

    if (count > max) {
      res.setHeader('Retry-After', String(Math.ceil((windowStart + windowMs - now) / 1000)));
      return res.status(429).json({ error: message || 'Too many requests, please slow down' });
    }
    return next();
  };
}

/* -------------------------------------------------------- security headers */

/**
 * Baseline security headers. No CSP is set because the SPA loads its own
 * scripts from the same origin and uses inline styles in a few places; a strict
 * CSP would need a nonce pipeline, which is out of scope here.
 */
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=(self)');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
}

module.exports = { rateLimit, securityHeaders };
