'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

const POST_SELECT = `
  SELECT p.*,
         u.username, u.display_name, u.avatar_color,
         (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id)    AS like_count,
         (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
  FROM posts p
  JOIN users u ON u.id = p.user_id
`;

function shape(row, viewerId) {
  if (!row) return null;
  return {
    id: row.id,
    body: row.body,
    imageUrl: row.image_url,
    createdAt: row.created_at,
    likeCount: row.like_count,
    commentCount: row.comment_count,
    liked: viewerId
      ? !!db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?').get(viewerId, row.id)
      : false,
    bookmarked: viewerId
      ? !!db
          .prepare('SELECT 1 FROM bookmarks WHERE user_id = ? AND post_id = ?')
          .get(viewerId, row.id)
      : false,
    author: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name,
      avatarColor: row.avatar_color,
    },
  };
}

function notify(userId, actorId, type, postId, body) {
  if (userId === actorId) return;
  db.prepare(
    `INSERT INTO notifications (user_id, actor_id, type, post_id, body) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, actorId, type, postId, body);
}

/** GET /api/posts?feed=following|all&username=&limit=&before= */
router.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
  const viewerId = req.user && req.user.id;
  let rows;

  if (req.query.username) {
    const author = db
      .prepare('SELECT id FROM users WHERE username = ?')
      .get(String(req.query.username).toLowerCase());
    if (!author) return res.status(404).json({ error: 'User not found' });
    rows = db
      .prepare(`${POST_SELECT} WHERE p.user_id = ? AND p.id < ? ORDER BY p.id DESC LIMIT ?`)
      .all(author.id, before, limit);
  } else if (req.query.feed === 'following' && viewerId) {
    rows = db
      .prepare(
        `${POST_SELECT}
         WHERE p.id < ?
           AND (p.user_id = ? OR p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?))
         ORDER BY p.id DESC LIMIT ?`
      )
      .all(before, viewerId, viewerId, limit);
  } else {
    rows = db
      .prepare(`${POST_SELECT} WHERE p.id < ? ORDER BY p.id DESC LIMIT ?`)
      .all(before, limit);
  }

  res.json({ posts: rows.map((r) => shape(r, viewerId)) });
});

/** GET /api/posts/search?q= */
router.get('/search', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ posts: [] });
  const rows = db
    .prepare(`${POST_SELECT} WHERE lower(p.body) LIKE ? ORDER BY p.id DESC LIMIT 30`)
    .all(`%${q.toLowerCase()}%`);
  res.json({ posts: rows.map((r) => shape(r, req.user && req.user.id)) });
});

/** GET /api/posts/bookmarks */
router.get('/bookmarks', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `${POST_SELECT}
       WHERE p.id IN (SELECT post_id FROM bookmarks WHERE user_id = ?)
       ORDER BY p.id DESC LIMIT 50`
    )
    .all(req.user.id);
  res.json({ posts: rows.map((r) => shape(r, req.user.id)) });
});

/** GET /api/posts/:id */
router.get('/:id', (req, res) => {
  const row = db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Post not found' });
  res.json({ post: shape(row, req.user && req.user.id) });
});

/** POST /api/posts */
router.post('/', requireAuth, (req, res) => {
  const body = (req.body && req.body.body ? String(req.body.body) : '').trim();
  const imageUrl = req.body && req.body.imageUrl ? String(req.body.imageUrl).slice(0, 500) : null;
  if (!body) return res.status(400).json({ error: 'Post body cannot be empty' });
  if (body.length > 500) return res.status(400).json({ error: 'Post is limited to 500 characters' });

  const info = db
    .prepare('INSERT INTO posts (user_id, body, image_url) VALUES (?, ?, ?)')
    .run(req.user.id, body, imageUrl);
  const row = db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(info.lastInsertRowid);
  res.status(201).json({ post: shape(row, req.user.id) });
});

/** DELETE /api/posts/:id */
router.delete('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Post not found' });
  if (row.user_id !== req.user.id) return res.status(403).json({ error: 'Not your post' });
  db.prepare('DELETE FROM posts WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

/** POST /api/posts/:id/like  |  DELETE to unlike */
router.post('/:id/like', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(req.params.id));
  if (!post) return res.status(404).json({ error: 'Post not found' });
  db.prepare('INSERT OR IGNORE INTO likes (user_id, post_id) VALUES (?, ?)').run(
    req.user.id,
    post.id
  );
  notify(post.user_id, req.user.id, 'like', post.id, `${req.user.display_name} liked your post`);
  const count = db.prepare('SELECT COUNT(*) AS c FROM likes WHERE post_id = ?').get(post.id).c;
  res.json({ liked: true, likeCount: count });
});

router.delete('/:id/like', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(req.params.id));
  if (!post) return res.status(404).json({ error: 'Post not found' });
  db.prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?').run(req.user.id, post.id);
  const count = db.prepare('SELECT COUNT(*) AS c FROM likes WHERE post_id = ?').get(post.id).c;
  res.json({ liked: false, likeCount: count });
});

/** POST /api/posts/:id/bookmark  |  DELETE */
router.post('/:id/bookmark', requireAuth, (req, res) => {
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(Number(req.params.id));
  if (!post) return res.status(404).json({ error: 'Post not found' });
  db.prepare('INSERT OR IGNORE INTO bookmarks (user_id, post_id) VALUES (?, ?)').run(
    req.user.id,
    post.id
  );
  res.json({ bookmarked: true });
});

router.delete('/:id/bookmark', requireAuth, (req, res) => {
  db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?').run(
    req.user.id,
    Number(req.params.id)
  );
  res.json({ bookmarked: false });
});

/** GET /api/posts/:id/comments */
router.get('/:id/comments', (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*, u.username, u.display_name, u.avatar_color
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ? ORDER BY c.id ASC LIMIT 200`
    )
    .all(Number(req.params.id));
  res.json({
    comments: rows.map((r) => ({
      id: r.id,
      body: r.body,
      createdAt: r.created_at,
      author: {
        id: r.user_id,
        username: r.username,
        displayName: r.display_name,
        avatarColor: r.avatar_color,
      },
    })),
  });
});

/** POST /api/posts/:id/comments */
router.post('/:id/comments', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(req.params.id));
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const body = (req.body && req.body.body ? String(req.body.body) : '').trim();
  if (!body) return res.status(400).json({ error: 'Comment cannot be empty' });
  if (body.length > 300) return res.status(400).json({ error: 'Comment is limited to 300 characters' });

  const info = db
    .prepare('INSERT INTO comments (post_id, user_id, body) VALUES (?, ?, ?)')
    .run(post.id, req.user.id, body);
  notify(
    post.user_id,
    req.user.id,
    'comment',
    post.id,
    `${req.user.display_name} commented: ${body.slice(0, 60)}`
  );
  const row = db
    .prepare(
      `SELECT c.*, u.username, u.display_name, u.avatar_color
       FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`
    )
    .get(info.lastInsertRowid);
  res.status(201).json({
    comment: {
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
      author: {
        id: row.user_id,
        username: row.username,
        displayName: row.display_name,
        avatarColor: row.avatar_color,
      },
    },
  });
});

/** DELETE /api/posts/:postId/comments/:commentId */
router.delete('/:postId/comments/:commentId', requireAuth, (req, res) => {
  const row = db
    .prepare('SELECT * FROM comments WHERE id = ? AND post_id = ?')
    .get(Number(req.params.commentId), Number(req.params.postId));
  if (!row) return res.status(404).json({ error: 'Comment not found' });
  if (row.user_id !== req.user.id) return res.status(403).json({ error: 'Not your comment' });
  db.prepare('DELETE FROM comments WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

module.exports = { router, shape };
