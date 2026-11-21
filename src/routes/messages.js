'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

function pair(a, b) {
  return a < b ? [a, b] : [b, a];
}

function findOrCreateConversation(a, b) {
  const [x, y] = pair(a, b);
  let row = db.prepare('SELECT * FROM conversations WHERE user_a = ? AND user_b = ?').get(x, y);
  if (!row) {
    const info = db
      .prepare('INSERT INTO conversations (user_a, user_b) VALUES (?, ?)')
      .run(x, y);
    row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(info.lastInsertRowid);
  }
  return row;
}

/** GET /api/messages — conversation list with last message + unread count */
router.get('/', requireAuth, (req, res) => {
  const me = req.user.id;
  const rows = db
    .prepare(
      `SELECT c.*,
              CASE WHEN c.user_a = ? THEN c.user_b ELSE c.user_a END AS other_id
       FROM conversations c
       WHERE c.user_a = ? OR c.user_b = ?
       ORDER BY c.id DESC`
    )
    .all(me, me, me);

  const conversations = rows.map((c) => {
    const other = db.prepare('SELECT * FROM users WHERE id = ?').get(c.other_id);
    const last = db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1')
      .get(c.id);
    const unread = db
      .prepare(
        'SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND sender_id != ? AND is_read = 0'
      )
      .get(c.id, me).n;
    return {
      id: c.id,
      unread,
      lastMessage: last
        ? { body: last.body, createdAt: last.created_at, senderId: last.sender_id }
        : null,
      user: other
        ? {
            id: other.id,
            username: other.username,
            displayName: other.display_name,
            avatarColor: other.avatar_color,
          }
        : null,
    };
  });

  res.json({ conversations });
});

/** POST /api/messages/open/:username — open (or create) a conversation */
router.post('/open/:username', requireAuth, (req, res) => {
  const other = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(String(req.params.username).toLowerCase());
  if (!other) return res.status(404).json({ error: 'User not found' });
  if (other.id === req.user.id) return res.status(400).json({ error: 'Cannot message yourself' });
  const conv = findOrCreateConversation(req.user.id, other.id);
  res.json({ conversationId: conv.id });
});

/** GET /api/messages/:conversationId */
router.get('/:conversationId', requireAuth, (req, res) => {
  const conv = db
    .prepare('SELECT * FROM conversations WHERE id = ?')
    .get(Number(req.params.conversationId));
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  if (conv.user_a !== req.user.id && conv.user_b !== req.user.id) {
    return res.status(403).json({ error: 'Not your conversation' });
  }
  db.prepare(
    'UPDATE messages SET is_read = 1 WHERE conversation_id = ? AND sender_id != ?'
  ).run(conv.id, req.user.id);

  const rows = db
    .prepare(
      `SELECT m.*, u.username, u.display_name, u.avatar_color
       FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = ? ORDER BY m.id ASC LIMIT 300`
    )
    .all(conv.id);

  const otherId = conv.user_a === req.user.id ? conv.user_b : conv.user_a;
  const other = db.prepare('SELECT * FROM users WHERE id = ?').get(otherId);

  res.json({
    conversationId: conv.id,
    user: other
      ? {
          id: other.id,
          username: other.username,
          displayName: other.display_name,
          avatarColor: other.avatar_color,
        }
      : null,
    messages: rows.map((m) => ({
      id: m.id,
      body: m.body,
      senderId: m.sender_id,
      createdAt: m.created_at,
      mine: m.sender_id === req.user.id,
    })),
  });
});

/** POST /api/messages/:conversationId — send a message */
router.post('/:conversationId', requireAuth, (req, res) => {
  const conv = db
    .prepare('SELECT * FROM conversations WHERE id = ?')
    .get(Number(req.params.conversationId));
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  if (conv.user_a !== req.user.id && conv.user_b !== req.user.id) {
    return res.status(403).json({ error: 'Not your conversation' });
  }
  const body = (req.body && req.body.body ? String(req.body.body) : '').trim();
  if (!body) return res.status(400).json({ error: 'Message cannot be empty' });
  if (body.length > 1000) return res.status(400).json({ error: 'Message is limited to 1000 characters' });

  const info = db
    .prepare('INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, ?, ?)')
    .run(conv.id, req.user.id, body);

  const otherId = conv.user_a === req.user.id ? conv.user_b : conv.user_a;
  db.prepare(
    `INSERT INTO notifications (user_id, actor_id, type, body) VALUES (?, ?, 'message', ?)`
  ).run(otherId, req.user.id, `${req.user.display_name} sent you a message`);

  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({
    message: {
      id: row.id,
      body: row.body,
      senderId: row.sender_id,
      createdAt: row.created_at,
      mine: true,
    },
  });
});

module.exports = router;
