'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { publicUser, requireAuth } = require('../auth');

const router = express.Router();

function countsFor(userId) {
  const followers = db
    .prepare('SELECT COUNT(*) AS c FROM follows WHERE followee_id = ?')
    .get(userId).c;
  const following = db
    .prepare('SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?')
    .get(userId).c;
  const posts = db.prepare('SELECT COUNT(*) AS c FROM posts WHERE user_id = ?').get(userId).c;
  return { followers, following, posts };
}

function profilePayload(row, viewerId) {
  const base = publicUser(row);
  const counts = countsFor(row.id);
  const isFollowing = viewerId
    ? !!db
        .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?')
        .get(viewerId, row.id)
    : false;
  return { ...base, ...counts, isFollowing, isSelf: viewerId === row.id };
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

/** GET /api/users/:username */
router.get('/:username', (req, res) => {
  const row = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(String(req.params.username).toLowerCase());
  if (!row) return res.status(404).json({ error: 'User not found' });
  res.json({ user: profilePayload(row, req.user && req.user.id) });
});

/** PATCH /api/users/me */
router.patch('/me', requireAuth, (req, res) => {
  const { displayName, bio, location, website, avatarColor } = req.body || {};
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
  db.prepare(
    `INSERT INTO notifications (user_id, actor_id, type, body) VALUES (?, ?, 'follow', ?)`
  ).run(target.id, req.user.id, `${req.user.display_name} started following you`);

  res.json({ following: true, counts: countsFor(target.id) });
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
