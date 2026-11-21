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

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(optionalAuth);

/* --------------------------------------------------------------- bootstrap */

/**
 * Promote ADMIN_USERNAME to admin on boot, and store ADMIN_PIN if given.
 * This is how the very first admin is created without a manual DB edit.
 */
function bootstrapAdmin() {
  const username = (process.env.ADMIN_USERNAME || '').trim().toLowerCase();
  if (username) {
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (row && row.role !== 'admin') {
      db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(row.id);
      console.log(`[bootstrap] @${username} promoted to admin`);
    }
  }
  const pin = process.env.ADMIN_PIN;
  if (pin && /^\d{4,8}$/.test(String(pin))) {
    const { hashPin } = require('./auth');
    db.prepare(
      `INSERT INTO settings (key, value, is_secret, updated_at)
       VALUES ('ADMIN_PIN', ?, 1, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(hashPin(String(pin)));
  }
}

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

app.use('/api/auth', authRoutes);
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

// The HTTP server is created explicitly so the WebSocket hub can share the
// same port: REST on /api/*, realtime on /ws.
const server = http.createServer(app);
realtime.attachRealtime(server);

if (require.main === module) {
  bootstrapAdmin();
  server.listen(PORT, () => {
    console.log(`CHOY-CHAT running on http://localhost:${PORT}`);
    console.log(`Realtime WebSocket listening on ws://localhost:${PORT}${realtime.WS_PATH}`);
  });
}

module.exports = app;
module.exports.server = server;
module.exports.realtime = realtime;
module.exports.bootstrapAdmin = bootstrapAdmin;
