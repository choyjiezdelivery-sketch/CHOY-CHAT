'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

/** GET /api/notifications */
router.get('/', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT n.*, u.username, u.display_name, u.avatar_color
       FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
       WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 50`
    )
    .all(req.user.id);
  const unread = db
    .prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0')
    .get(req.user.id).c;
  res.json({
    unread,
    notifications: rows.map((r) => ({
      id: r.id,
      type: r.type,
      body: r.body,
      postId: r.post_id,
      isRead: !!r.is_read,
      createdAt: r.created_at,
      actor: r.actor_id
        ? {
            id: r.actor_id,
            username: r.username,
            displayName: r.display_name,
            avatarColor: r.avatar_color,
          }
        : null,
    })),
  });
});

/** POST /api/notifications/read — mark all read */
router.post('/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

/** DELETE /api/notifications — clear all */
router.delete('/', requireAuth, (req, res) => {
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
