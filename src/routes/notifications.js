'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const realtime = require('../realtime');
const { shapeNotification, unreadCount, SELECT_ONE } = require('../notify');

const router = express.Router();

/** GET /api/notifications */
router.get('/', requireAuth, (req, res) => {
  const rows = db
    .prepare(`${SELECT_ONE} WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 50`)
    .all(req.user.id);
  res.json({
    unread: unreadCount(req.user.id),
    notifications: rows.map(shapeNotification),
  });
});

/** POST /api/notifications/read — mark all read */
router.post('/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  realtime.emitToUser(req.user.id, 'notification:read', { unread: 0 });
  res.json({ ok: true });
});

/** DELETE /api/notifications — clear all */
router.delete('/', requireAuth, (req, res) => {
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user.id);
  realtime.emitToUser(req.user.id, 'notification:clear', { unread: 0 });
  res.json({ ok: true });
});

module.exports = router;
