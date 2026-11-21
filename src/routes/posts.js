'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const realtime = require('../realtime');
const { createNotification } = require('../notify');

const router = express.Router();

const POST_SELECT = `
  SELECT p.*,
         u.username, u.display_name, u.avatar_color, u.avatar_url,
         (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id)    AS like_count,
         (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
         (SELECT COUNT(*) FROM shares s WHERE s.post_id = p.id)   AS share_count
  FROM posts p
  JOIN users u ON u.id = p.user_id
`;

function shape(row, viewerId) {
  if (!row) return null;
  const post = {
    id: row.id,
    body: row.body,
    imageUrl: row.image_url,
    mediaType: row.media_type || 'none',
    mediaUrl: row.media_url || row.image_url || null,
    shareOf: row.share_of || null,
    createdAt: row.created_at,
    likeCount: row.like_count,
    commentCount: row.comment_count,
    shareCount: row.share_count || 0,
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
      avatarUrl: row.avatar_url || null,
    },
  };

  // A share carries a snapshot of the original so the client can render it
  // without a second request.
  if (row.share_of) {
    const original = db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(row.share_of);
    post.original = original ? shape(original, viewerId) : null;
  }
  return post;
}

/** Writes the notification row and pushes it over the realtime hub. */
function notify(userId, actorId, type, postId, body) {
  return createNotification({ userId, actorId, type, postId, body });
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

/**
 * POST /api/posts
 * body: { body, mediaType: 'none'|'image'|'video', mediaUrl, imageUrl }
 * A post may be text-only, media-only, or both.
 */
router.post('/', requireAuth, (req, res) => {
  const body = (req.body && req.body.body ? String(req.body.body) : '').trim();
  const mediaType = ['image', 'video'].includes(req.body && req.body.mediaType)
    ? req.body.mediaType
    : 'none';
  const mediaUrl =
    (req.body && (req.body.mediaUrl || req.body.imageUrl)) != null
      ? String(req.body.mediaUrl || req.body.imageUrl).slice(0, 1000)
      : null;

  if (!body && !mediaUrl) {
    return res.status(400).json({ error: 'A post needs text or media' });
  }
  if (body.length > 500) return res.status(400).json({ error: 'Post is limited to 500 characters' });

  const info = db
    .prepare(
      'INSERT INTO posts (user_id, body, image_url, media_type, media_url) VALUES (?, ?, ?, ?, ?)'
    )
    .run(req.user.id, body, mediaType === 'image' ? mediaUrl : null, mediaType, mediaUrl);
  const row = db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(info.lastInsertRowid);
  const post = shape(row, req.user.id);

  // Live timeline: everyone else sees the new post without refreshing.
  realtime.broadcast('post:new', { post }, { exceptUserId: req.user.id });

  res.status(201).json({ post });
});

/** DELETE /api/posts/:id */
router.delete('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Post not found' });
  if (row.user_id !== req.user.id) return res.status(403).json({ error: 'Not your post' });
  db.prepare('DELETE FROM posts WHERE id = ?').run(row.id);
  realtime.broadcast('post:deleted', { postId: row.id });
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
  realtime.emitToUser(post.user_id, 'post:like', {
    postId: post.id,
    likeCount: count,
    likedBy: {
      id: req.user.id,
      username: req.user.username,
      displayName: req.user.display_name,
    },
  });
  res.json({ liked: true, likeCount: count });
});

router.delete('/:id/like', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(req.params.id));
  if (!post) return res.status(404).json({ error: 'Post not found' });
  db.prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?').run(req.user.id, post.id);
  const count = db.prepare('SELECT COUNT(*) AS c FROM likes WHERE post_id = ?').get(post.id).c;
  res.json({ liked: false, likeCount: count });
});

/** POST /api/posts/:id/share — repost to your own timeline */
router.post('/:id/share', requireAuth, (req, res) => {
  const original = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(req.params.id));
  if (!original) return res.status(404).json({ error: 'Post not found' });

  const note = (req.body && req.body.body ? String(req.body.body) : '').trim().slice(0, 500);

  db.prepare('INSERT INTO shares (user_id, post_id) VALUES (?, ?)').run(req.user.id, original.id);
  const info = db
    .prepare(
      'INSERT INTO posts (user_id, body, media_type, media_url, share_of) VALUES (?, ?, ?, ?, ?)'
    )
    .run(req.user.id, note, 'none', null, original.id);

  const row = db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(info.lastInsertRowid);
  const post = shape(row, req.user.id);

  notify(
    original.user_id,
    req.user.id,
    'share',
    original.id,
    `${req.user.display_name} shared your post`
  );
  realtime.broadcast('post:new', { post }, { exceptUserId: req.user.id });
  realtime.emitToUser(original.user_id, 'post:share', {
    postId: original.id,
    shareCount: db.prepare('SELECT COUNT(*) AS c FROM shares WHERE post_id = ?').get(original.id).c,
    sharedBy: { id: req.user.id, username: req.user.username, displayName: req.user.display_name },
  });

  res.status(201).json({ post });
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
      `SELECT c.*, u.username, u.display_name, u.avatar_color, u.avatar_url
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
        avatarUrl: r.avatar_url || null,
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
      `SELECT c.*, u.username, u.display_name, u.avatar_color, u.avatar_url
       FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`
    )
    .get(info.lastInsertRowid);
  const comment = {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    author: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name,
      avatarColor: row.avatar_color,
      avatarUrl: row.avatar_url || null,
    },
  };
  const commentCount = db
    .prepare('SELECT COUNT(*) AS c FROM comments WHERE post_id = ?')
    .get(post.id).c;
  realtime.emitToUser(post.user_id, 'post:comment', {
    postId: post.id,
    commentCount,
    comment,
  });
  res.status(201).json({ comment });
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
