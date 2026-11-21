'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { publicUser, requireAuth, hashPin, verifyPin } = require('../auth');
const realtime = require('../realtime');
const { createNotification } = require('../notify');

const router = express.Router();

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

function countsFor(userId) {
  const followers = db
    .prepare('SELECT COUNT(*) AS c FROM follows WHERE followee_id = ?')
    .get(userId).c;
  const following = db
    .prepare('SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?')
    .get(userId).c;
  const posts = db.prepare('SELECT COUNT(*) AS c FROM posts WHERE user_id = ?').get(userId).c;
  const friends = db
    .prepare(
      `SELECT COUNT(*) AS c FROM friendships
       WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`
    )
    .get(userId, userId).c;
  return { followers, following, posts, friends };
}

function profilePayload(row, viewerId) {
  const base = publicUser(row);
  const counts = countsFor(row.id);
  const isFollowing = viewerId
    ? !!db
        .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?')
        .get(viewerId, row.id)
    : false;
  const friendship = viewerId
    ? db
        .prepare(
          `SELECT * FROM friendships
           WHERE (requester_id = ? AND addressee_id = ?)
              OR (requester_id = ? AND addressee_id = ?)`
        )
        .get(viewerId, row.id, row.id, viewerId)
    : null;
  const friendState = !friendship
    ? 'none'
    : friendship.status === 'accepted'
      ? 'friends'
      : friendship.requester_id === viewerId
        ? 'outgoing'
        : 'incoming';

  return {
    ...base,
    ...counts,
    isFollowing,
    isSelf: viewerId === row.id,
    friendState,
    online: realtime.isOnline(row.id),
  };
}

/** GET /api/users?q=  — search / directory */
router.get('/', (req, res) => {
  const q = (req.query.q || '').toString().trim().toLowerCase();
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  let rows;
  if (q) {
    rows = db
      .prepare(
        `SELECT * FROM users
         WHERE lower(username) LIKE ? OR lower(display_name) LIKE ?
         ORDER BY username LIMIT ?`
      )
      .all(`%${q}%`, `%${q}%`, limit);
  } else {
    rows = db.prepare('SELECT * FROM users ORDER BY id DESC LIMIT ?').all(limit);
  }
  res.json({ users: rows.map((r) => profilePayload(r, req.user && req.user.id)) });
});

/** GET /api/users/suggested — people you don't follow yet */
router.get('/suggested', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM users
       WHERE id != ?
         AND id NOT IN (SELECT followee_id FROM follows WHERE follower_id = ?)
       ORDER BY (SELECT COUNT(*) FROM follows f WHERE f.followee_id = users.id) DESC, id DESC
       LIMIT 5`
    )
    .all(req.user.id, req.user.id);
  res.json({ users: rows.map((r) => profilePayload(r, req.user.id)) });
});

/** GET /api/users/me — full own profile */
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: profilePayload(req.user, req.user.id) });
});

/** PATCH /api/users/me */
router.patch('/me', requireAuth, (req, res) => {
  const { displayName, bio, location, website, avatarColor, avatarUrl, coverUrl } = req.body || {};
  const fields = [];
  const values = [];
  const push = (col, val) => {
    if (val !== undefined) {
      fields.push(`${col} = ?`);
      values.push(val);
    }
  };
  push('display_name', displayName !== undefined ? String(displayName).slice(0, 50) : undefined);
  push('bio', bio !== undefined ? String(bio).slice(0, 200) : undefined);
  push('location', location !== undefined ? String(location).slice(0, 60) : undefined);
  push('website', website !== undefined ? String(website).slice(0, 120) : undefined);
  push('avatar_color', avatarColor !== undefined ? String(avatarColor).slice(0, 20) : undefined);
  push('avatar_url', avatarUrl !== undefined ? (avatarUrl ? String(avatarUrl).slice(0, 1000) : null) : undefined);
  push('cover_url', coverUrl !== undefined ? (coverUrl ? String(coverUrl).slice(0, 1000) : null) : undefined);

  if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
  values.push(req.user.id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: profilePayload(row, req.user.id) });
});

/** POST /api/users/me/password */
router.post('/me/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (!bcrypt.compareSync(String(currentPassword), req.user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
    bcrypt.hashSync(String(newPassword), 10),
    req.user.id
  );
  res.json({ ok: true });
});

/**
 * POST /api/users/me/pin — set or change the account PIN.
 * body: { pin, currentPin? }
 * The PIN is required to change the username, so it is a second factor for
 * the most damaging account change.
 */
router.post('/me/pin', requireAuth, (req, res) => {
  const pin = req.body && req.body.pin != null ? String(req.body.pin) : '';
  const currentPin = req.body && req.body.currentPin != null ? String(req.body.currentPin) : null;

  if (!/^\d{4,8}$/.test(pin)) {
    return res.status(400).json({ error: 'PIN must be 4-8 digits' });
  }
  if (req.user.pin_hash && !verifyPin(currentPin || '', req.user.pin_hash)) {
    return res.status(401).json({ error: 'Current PIN is incorrect' });
  }
  db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(hashPin(pin), req.user.id);
  res.json({ ok: true, hasPin: true });
});

/** DELETE /api/users/me/pin — remove the PIN (requires the current PIN) */
router.delete('/me/pin', requireAuth, (req, res) => {
  if (!req.user.pin_hash) return res.json({ ok: true, hasPin: false });
  const currentPin = req.body && req.body.currentPin != null ? String(req.body.currentPin) : '';
  if (!verifyPin(currentPin, req.user.pin_hash)) {
    return res.status(401).json({ error: 'Current PIN is incorrect' });
  }
  db.prepare('UPDATE users SET pin_hash = NULL WHERE id = ?').run(req.user.id);
  res.json({ ok: true, hasPin: false });
});

/**
 * POST /api/users/me/username — change the username.
 * body: { username, pin }
 * Requires the account PIN when one is set.
 */
router.post('/me/username', requireAuth, (req, res) => {
  const next = String((req.body && req.body.username) || '').trim().toLowerCase();
  const pin = req.body && req.body.pin != null ? String(req.body.pin) : '';

  if (!USERNAME_RE.test(next)) {
    return res.status(400).json({ error: 'Username must be 3-20 chars: a-z, 0-9, underscore' });
  }
  if (next === req.user.username) {
    return res.status(400).json({ error: 'That is already your username' });
  }
  if (req.user.pin_hash && !verifyPin(pin, req.user.pin_hash)) {
    return res.status(401).json({ error: 'PIN is required to change your username' });
  }
  const clash = db.prepare('SELECT id FROM users WHERE username = ?').get(next);
  if (clash) return res.status(409).json({ error: 'That username is taken' });

  db.prepare('UPDATE users SET username = ? WHERE id = ?').run(next, req.user.id);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  // The old token still carries the old username, so hand back a fresh one.
  const { signToken } = require('../auth');
  res.json({ ok: true, user: profilePayload(row, req.user.id), token: signToken(row) });
});

/** GET /api/users/:username */
router.get('/:username', (req, res) => {
  const row = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(String(req.params.username).toLowerCase());
  if (!row) return res.status(404).json({ error: 'User not found' });
  res.json({ user: profilePayload(row, req.user && req.user.id) });
});

/** GET /api/users/:username/posts — every post by this user (profile page) */
router.get('/:username/posts', (req, res) => {
  const row = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(String(req.params.username).toLowerCase());
  if (!row) return res.status(404).json({ error: 'User not found' });
  const { shape } = require('./posts');
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const rows = db
    .prepare(
      `SELECT p.*, u.username, u.display_name, u.avatar_color, u.avatar_url,
              (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id)    AS like_count,
              (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
              (SELECT COUNT(*) FROM shares s WHERE s.post_id = p.id)   AS share_count
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.user_id = ? ORDER BY p.id DESC LIMIT ?`
    )
    .all(row.id, limit);
  res.json({ posts: rows.map((r) => shape(r, req.user && req.user.id)) });
});

/** POST /api/users/:username/follow  |  DELETE to unfollow */
router.post('/:username/follow', requireAuth, (req, res) => {
  const target = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(String(req.params.username).toLowerCase());
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot follow yourself' });

  db.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)').run(
    req.user.id,
    target.id
  );
  createNotification({
    userId: target.id,
    actorId: req.user.id,
    type: 'follow',
    body: `${req.user.display_name} started following you`,
  });

  const counts = countsFor(target.id);
  realtime.emitToUser(target.id, 'follow:new', {
    follower: {
      id: req.user.id,
      username: req.user.username,
      displayName: req.user.display_name,
      avatarColor: req.user.avatar_color,
      avatarUrl: req.user.avatar_url || null,
    },
    counts,
  });

  res.json({ following: true, counts });
});

router.delete('/:username/follow', requireAuth, (req, res) => {
  const target = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(String(req.params.username).toLowerCase());
  if (!target) return res.status(404).json({ error: 'User not found' });
  db.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').run(
    req.user.id,
    target.id
  );
  res.json({ following: false, counts: countsFor(target.id) });
});

/** GET /api/users/:username/followers | /following */
router.get('/:username/followers', (req, res) => {
  const target = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(String(req.params.username).toLowerCase());
  if (!target) return res.status(404).json({ error: 'User not found' });
  const rows = db
    .prepare(
      `SELECT u.* FROM follows f JOIN users u ON u.id = f.follower_id
       WHERE f.followee_id = ? ORDER BY f.created_at DESC LIMIT 100`
    )
    .all(target.id);
  res.json({ users: rows.map((r) => profilePayload(r, req.user && req.user.id)) });
});

router.get('/:username/following', (req, res) => {
  const target = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(String(req.params.username).toLowerCase());
  if (!target) return res.status(404).json({ error: 'User not found' });
  const rows = db
    .prepare(
      `SELECT u.* FROM follows f JOIN users u ON u.id = f.followee_id
       WHERE f.follower_id = ? ORDER BY f.created_at DESC LIMIT 100`
    )
    .all(target.id);
  res.json({ users: rows.map((r) => profilePayload(r, req.user && req.user.id)) });
});

module.exports = { router, profilePayload, countsFor };
