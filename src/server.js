'use strict';

require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');

const { optionalAuth } = require('./auth');
const realtime = require('./realtime');
const authRoutes = require('./routes/auth');
const { router: userRoutes } = require('./routes/users');
const { router: postRoutes } = require('./routes/posts');
const notificationRoutes = require('./routes/notifications');
const messageRoutes = require('./routes/messages');
const searchRoutes = require('./routes/search');

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(optionalAuth);

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'CHOY-CHAT',
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

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found' }));

app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback for non-API routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = Number(process.env.PORT) || 3000;

// The HTTP server is created explicitly so the WebSocket hub can share the
// same port: REST on /api/*, realtime on /ws.
const server = http.createServer(app);
realtime.attachRealtime(server);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`CHOY-CHAT running on http://localhost:${PORT}`);
    console.log(`Realtime WebSocket listening on ws://localhost:${PORT}${realtime.WS_PATH}`);
  });
}

module.exports = app;
module.exports.server = server;
module.exports.realtime = realtime;
