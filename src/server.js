'use strict';

require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');

const db = require('./db');
const { optionalAuth } = require('./auth');
const realtime = require('./realtime');
const { UPLOAD_DIR } = require('./uploads');
const { rateLimit, securityHeaders } = require('./security');

const authRoutes = require('./routes/auth');
const { router: userRoutes } = require('./routes/users');
const { router: postRoutes } = require('./routes/posts');
const notificationRoutes = require('./routes/notifications');
const messageRoutes = require('./routes/messages');
const searchRoutes = require('./routes/search');
const { router: friendRoutes } = require('./routes/friends');
const { router: groupRoutes } = require('./routes/groups');
const gpsRoutes = require('./routes/gps');
const callRoutes = require('./routes/calls');
const mediaRoutes = require('./routes/media');
const { router: adminRoutes } = require('./routes/admin');

const app = express();

// Behind a host's reverse proxy (Render, Railway, Fly, Heroku) the client IP
// arrives in X-Forwarded-For. Trusting one hop makes req.ip correct, which the
// rate limiter depends on. Left off in development so a spoofed header cannot
// bypass the limiter locally.
if (process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

app.disable('x-powered-by');
app.use(securityHeaders);
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(optionalAuth);

/* --------------------------------------------------------------- bootstrap */

/**
 * First-run bootstrap: seeds demo data only when the database is empty, then
 * makes sure ADMIN_USERNAME exists and is an admin. Idempotent, so a redeploy
 * against a persistent disk never touches existing data.
 */
const { bootstrap: runBootstrap } = require('./bootstrap');

/* ------------------------------------------------------------------ routes */

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'CHOY-CHAT',
    version: '2.0.0',
    time: new Date().toISOString(),
    realtime: {
      path: realtime.WS_PATH,
      connections: realtime.connectionCount(),
      online: realtime.onlineUserIds().length,
    },
  });
});

// Credential endpoints are the ones worth throttling: 20 attempts per IP per
// 15 minutes is far above normal use but stops scripted password guessing.
// Disabled when RATE_LIMIT_DISABLED=true so the test suite can hammer them.
const authLimiter =
  process.env.RATE_LIMIT_DISABLED === 'true'
    ? (_req, _res, next) => next()
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
        message: 'Too many sign-in attempts. Try again in a few minutes.',
      });

/**
 * Readiness probe. Unlike /health (which only proves the process is up), this
 * touches the database, so a host can tell "running" from "actually usable".
 */
app.get('/api/ready', (_req, res) => {
  try {
    db.prepare('SELECT 1 AS ok').get();
    res.json({ ready: true, db: 'ok' });
  } catch (err) {
    res.status(503).json({ ready: false, db: 'error', error: err.message });
  }
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/gps', gpsRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/admin', adminRoutes);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found' }));

// Uploaded media (local storage driver).
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback for non-API routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File is too large' });
  }
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = Number(process.env.PORT) || 3000;

/**
 * Refuse to boot in production with the development JWT secret. Shipping the
 * fallback secret would let anyone forge a token for any account, so this is a
 * hard failure rather than a warning.
 */
function assertProductionSecrets() {
  if (process.env.NODE_ENV !== 'production') return;
  const secret = process.env.JWT_SECRET || '';
  if (!secret || secret === 'choy-chat-dev-secret-change-me' || secret.length < 32) {
    console.error(
      '[fatal] JWT_SECRET must be set to a random string of at least 32 characters in production.\n' +
        '        Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"'
    );
    process.exit(1);
  }
}

// The HTTP server is created explicitly so the WebSocket hub can share the
// same port: REST on /api/*, realtime on /ws.
const server = http.createServer(app);
realtime.attachRealtime(server);

if (require.main === module) {
  assertProductionSecrets();
  runBootstrap();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`CHOY-CHAT running on http://localhost:${PORT}`);
    console.log(`Realtime WebSocket listening on ws://localhost:${PORT}${realtime.WS_PATH}`);
  });

  // Hosts send SIGTERM on redeploy. Close the listener and the database so the
  // SQLite WAL is checkpointed instead of being left mid-write.
  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received, closing server`);
    server.close(() => {
      try {
        db.close();
      } catch (_err) {
        /* already closed */
      }
      console.log('[shutdown] done');
      process.exit(0);
    });
    // Do not hang forever if a socket refuses to close.
    setTimeout(() => process.exit(0), 10000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
module.exports.server = server;
module.exports.realtime = realtime;
module.exports.bootstrapAdmin = runBootstrap;
