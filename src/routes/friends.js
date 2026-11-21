'use strict';

/**
 * Friends — a request/accept layer on top of the follow graph.
 *
 *   GET    /api/friends                 my friends + incoming/outgoing requests
 *   GET    /api/friends/search?q=       find people to add
 *   POST   /api/friends/request/:username
 *   POST   /api/friends/accept/:username
 *   POST   /api/friends/decline/:username
 *   DELETE /api/friends/:username       unfriend
 */

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const realtime = require('../realtime');
const { createNotification } = require('../notify');

const router = express.Router();

function brief(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
    avatarUrl: row.avatar_url || null,
    bio: row.bio,
  };
}

function findUser(username) {
  return db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(String(username || '').toLowerCase());
}

/** The friendship row between two users, in either direction. */
function linkBetween(a, b) {
  return db
    .prepare(
      `SELECT * FROM friendships
       WHERE (requester_id = ? AND addressee_id = ?)
          OR (requester_id = ? AND addressee_id = ?)`
    )
    .get(a, b, b, a);
}

function friendIds(userId) {
  const rows = db
    .prepare(
      `SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS friend_id
       FROM friendships
       WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`
    )
    .all(userId, userId, userId);
  return rows.map((r) => r.friend_id);
}

/** GET /api/friends */
router.get('/', requireAuth, (req, res) => {
  const me = req.user.id;

  const friends = db
    .prepare(
      `SELECT u.* FROM users u
       WHERE u.id IN (
         SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END
         FROM friendships
         WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)
       )
       ORDER BY u.display_name`
    )
    .all(me, me, me);

  const incoming = db
    .prepare(
      `SELECT u.*, f.id AS request_id, f.created_at AS requested_at
       FROM friendships f JOIN users u ON u.id = f.requester_id
       WHERE f.addressee_id = ? AND f.status = 'pending'
       ORDER BY f.id DESC`
    )
    .all(me);

  const outgoing = db
    .prepare(
      `SELECT u.*, f.id AS request_id, f.created_at AS requested_at
       FROM friendships f JOIN users u ON u.id = f.addressee_id
       WHERE f.requester_id = ? AND f.status = 'pending'
       ORDER BY f.id DESC`
    )
    .all(me);

  res.json({
    friends: friends.map(brief),
    incoming: incoming.map((r) => ({ ...brief(r), requestedAt: r.requested_at })),
    outgoing: outgoing.map((r) => ({ ...brief(r), requestedAt: r.requested_at })),
  });
});

/** GET /api/friends/search?q= — people you are not friends with yet */
router.get('/search', requireAuth, (req, res) => {
  const q = (req.query.q || '').toString().trim().toLowerCase();
  const me = req.user.id;
  const exclude = friendIds(me);
  const placeholders = exclude.map(() => '?').join(',');

  const sql = `
    SELECT * FROM users
    WHERE id != ?
      ${exclude.length ? `AND id NOT IN (${placeholders})` : ''}
      ${q ? 'AND (lower(username) LIKE ? OR lower(display_name) LIKE ?)' : ''}
    ORDER BY display_name LIMIT 30`;

  const params = [me, ...exclude];
  if (q) params.push(`%${q}%`, `%${q}%`);

  const rows = db.prepare(sql).all(...params);
  res.json({
    users: rows.map((r) => {
      const link = linkBetween(me, r.id);
      return {
        ...brief(r),
        requestState: !link ? 'none' : link.status === 'accepted' ? 'friends' : link.requester_id === me ? 'outgoing' : 'incoming',
      };
    }),
  });
});

/** POST /api/friends/request/:username */
router.post('/request/:username', requireAuth, (req, res) => {
  const target = findUser(req.params.username);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot add yourself' });

  const existing = linkBetween(req.user.id, target.id);
  if (existing) {
    if (existing.status === 'accepted') return res.json({ state: 'friends' });
    if (existing.requester_id === req.user.id) return res.json({ state: 'outgoing' });
    // They already asked us — accept instead of creating a mirror row.
    db.prepare("UPDATE friendships SET status = 'accepted', updated_at = datetime('now') WHERE id = ?").run(existing.id);
    realtime.emitToUser(target.id, 'friend:accepted', { user: brief(req.user) });
    return res.json({ state: 'friends' });
  }

  db.prepare('INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, ?)').run(
    req.user.id,
    target.id,
    'pending'
  );
  createNotification({
    userId: target.id,
    actorId: req.user.id,
    type: 'friend_request',
    body: `${req.user.display_name} sent you a friend request`,
  });
  realtime.emitToUser(target.id, 'friend:request', { user: brief(req.user) });
  res.status(201).json({ state: 'outgoing' });
});

/** POST /api/friends/accept/:username */
router.post('/accept/:username', requireAuth, (req, res) => {
  const target = findUser(req.params.username);
  if (!target) return res.status(404).json({ error: 'User not found' });
  const link = linkBetween(req.user.id, target.id);
  if (!link || link.status !== 'pending' || link.addressee_id !== req.user.id) {
    return res.status(404).json({ error: 'No pending request from that user' });
  }
  db.prepare("UPDATE friendships SET status = 'accepted', updated_at = datetime('now') WHERE id = ?").run(link.id);
  createNotification({
    userId: target.id,
    actorId: req.user.id,
    type: 'friend_accepted',
    body: `${req.user.display_name} accepted your friend request`,
  });
  realtime.emitToUser(target.id, 'friend:accepted', { user: brief(req.user) });
  res.json({ state: 'friends' });
});

/** POST /api/friends/decline/:username */
router.post('/decline/:username', requireAuth, (req, res) => {
  const target = findUser(req.params.username);
  if (!target) return res.status(404).json({ error: 'User not found' });
  const link = linkBetween(req.user.id, target.id);
  if (!link) return res.status(404).json({ error: 'No request to decline' });
  db.prepare('DELETE FROM friendships WHERE id = ?').run(link.id);
  res.json({ state: 'none' });
});

/** DELETE /api/friends/:username — unfriend */
router.delete('/:username', requireAuth, (req, res) => {
  const target = findUser(req.params.username);
  if (!target) return res.status(404).json({ error: 'User not found' });
  const link = linkBetween(req.user.id, target.id);
  if (!link) return res.status(404).json({ error: 'Not friends' });
  db.prepare('DELETE FROM friendships WHERE id = ?').run(link.id);
  res.json({ state: 'none' });
});

module.exports = { router, friendIds, brief };
