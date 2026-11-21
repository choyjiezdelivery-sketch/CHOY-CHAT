'use strict';

/**
 * Notification creation + shaping.
 *
 * Every notification is written to SQLite and pushed over the realtime hub in
 * the same call, so the REST list and the live socket can never disagree.
 */

const db = require('./db');
const realtime = require('./realtime');

const SELECT_ONE = `
  SELECT n.*, u.username, u.display_name, u.avatar_color
  FROM notifications n
  LEFT JOIN users u ON u.id = n.actor_id
`;

function shapeNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    body: row.body,
    postId: row.post_id,
    isRead: !!row.is_read,
    createdAt: row.created_at,
    actor: row.actor_id
      ? {
          id: row.actor_id,
          username: row.username,
          displayName: row.display_name,
          avatarColor: row.avatar_color,
        }
      : null,
  };
}

function unreadCount(userId) {
  return db
    .prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0')
    .get(userId).c;
}

/**
 * Insert a notification and push it live.
 * Self-notifications (you liking your own post) are silently skipped.
 * Returns the shaped notification, or null when nothing was created.
 */
function createNotification({ userId, actorId = null, type, postId = null, body = '' }) {
  if (actorId != null && Number(userId) === Number(actorId)) return null;

  const info = db
    .prepare(
      `INSERT INTO notifications (user_id, actor_id, type, post_id, body)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(userId, actorId, type, postId, body);

  const row = db.prepare(`${SELECT_ONE} WHERE n.id = ?`).get(info.lastInsertRowid);
  const notification = shapeNotification(row);
  const unread = unreadCount(userId);

  realtime.emitToUser(userId, 'notification:new', { notification, unread });
  return notification;
}

module.exports = { createNotification, shapeNotification, unreadCount, SELECT_ONE };
