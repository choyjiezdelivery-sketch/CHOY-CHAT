'use strict';

const express = require('express');
const db = require('../db');

const router = express.Router();

/** GET /api/search?q= — users + posts in one call */
router.get('/', (req, res) => {
  const q = (req.query.q || '').toString().trim().toLowerCase();
  if (!q) return res.json({ users: [], posts: [] });

  const users = db
    .prepare(
      `SELECT id, username, display_name, avatar_color, bio FROM users
       WHERE lower(username) LIKE ? OR lower(display_name) LIKE ?
       ORDER BY username LIMIT 10`
    )
    .all(`%${q}%`, `%${q}%`);

  const posts = db
    .prepare(
      `SELECT p.id, p.body, p.created_at, u.username, u.display_name, u.avatar_color
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE lower(p.body) LIKE ? ORDER BY p.id DESC LIMIT 20`
    )
    .all(`%${q}%`);

  res.json({
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      avatarColor: u.avatar_color,
      bio: u.bio,
    })),
    posts: posts.map((p) => ({
      id: p.id,
      body: p.body,
      createdAt: p.created_at,
      author: {
        username: p.username,
        displayName: p.display_name,
        avatarColor: p.avatar_color,
      },
    })),
  });
});

/** GET /api/search/trending — most-liked recent posts */
router.get('/trending', (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.id, p.body, p.created_at, u.username, u.display_name, u.avatar_color,
              (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count
       FROM posts p JOIN users u ON u.id = p.user_id
       ORDER BY like_count DESC, p.id DESC LIMIT 10`
    )
    .all();
  res.json({
    posts: rows.map((p) => ({
      id: p.id,
      body: p.body,
      createdAt: p.created_at,
      likeCount: p.like_count,
      author: {
        username: p.username,
        displayName: p.display_name,
        avatarColor: p.avatar_color,
      },
    })),
  });
});

module.exports = router;
