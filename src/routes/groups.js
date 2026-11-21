'use strict';

/**
 * Group messaging.
 *
 *   GET    /api/groups                     my groups
 *   POST   /api/groups                     create { name, members: [username] }
 *   GET    /api/groups/:id                 group + members
 *   POST   /api/groups/:id/members         add { username }
 *   DELETE /api/groups/:id/members/:username
 *   GET    /api/groups/:id/messages
 *   POST   /api/groups/:id/messages        { body, mediaType, mediaUrl }
 *   DELETE /api/groups/:id                 owner only
 */

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const realtime = require('../realtime');

const router = express.Router();

function brief(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
    avatarUrl: row.avatar_url || null,
  };
}

function isMember(groupId, userId) {
  return !!db
    .prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(groupId, userId);
}

function memberIds(groupId) {
  return db
    .prepare('SELECT user_id FROM group_members WHERE group_id = ?')
    .all(groupId)
    .map((r) => r.user_id);
}

function groupPayload(group, viewerId) {
  const members = db
    .prepare(
      `SELECT u.*, gm.role FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ? ORDER BY gm.joined_at`
    )
    .all(group.id);
  const last = db
    .prepare('SELECT * FROM group_messages WHERE group_id = ? ORDER BY id DESC LIMIT 1')
    .get(group.id);
  return {
    id: group.id,
    name: group.name,
    avatarColor: group.avatar_color,
    ownerId: group.owner_id,
    createdAt: group.created_at,
    isOwner: group.owner_id === viewerId,
    memberCount: members.length,
    members: members.map((m) => ({ ...brief(m), role: m.role })),
    lastMessage: last
      ? { body: last.body, mediaType: last.media_type, createdAt: last.created_at, senderId: last.sender_id }
      : null,
  };
}

function shapeMessage(row, viewerId) {
  return {
    id: row.id,
    body: row.body,
    mediaType: row.media_type || 'none',
    mediaUrl: row.media_url || null,
    senderId: row.sender_id,
    createdAt: row.created_at,
    mine: row.sender_id === viewerId,
    author: {
      id: row.sender_id,
      username: row.username,
      displayName: row.display_name,
      avatarColor: row.avatar_color,
    },
  };
}

/** GET /api/groups */
router.get('/', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT g.* FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = ? ORDER BY g.id DESC`
    )
    .all(req.user.id);
  res.json({ groups: rows.map((g) => groupPayload(g, req.user.id)) });
});

/** POST /api/groups */
router.post('/', requireAuth, (req, res) => {
  const name = (req.body && req.body.name ? String(req.body.name) : '').trim();
  if (!name) return res.status(400).json({ error: 'Group name is required' });
  if (name.length > 60) return res.status(400).json({ error: 'Group name is limited to 60 characters' });

  const colors = ['#00b894', '#6c5ce7', '#e17055', '#0984e3', '#d63031', '#fdcb6e'];
  const color = colors[Math.floor(Math.random() * colors.length)];

  const info = db
    .prepare('INSERT INTO groups (name, owner_id, avatar_color) VALUES (?, ?, ?)')
    .run(name, req.user.id, color);
  const groupId = info.lastInsertRowid;

  db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'owner')").run(
    groupId,
    req.user.id
  );

  const usernames = Array.isArray(req.body && req.body.members) ? req.body.members : [];
  const added = [];
  for (const uname of usernames.slice(0, 50)) {
    const u = db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(String(uname).toLowerCase());
    if (!u || u.id === req.user.id) continue;
    db.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')").run(
      groupId,
      u.id
    );
    added.push(u.id);
  }

  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  const payload = groupPayload(group, req.user.id);

  // Everyone added sees the new group appear live.
  realtime.emitToUsers(added, 'group:new', { group: groupPayload(group, null) });
  res.status(201).json({ group: payload });
});

/** GET /api/groups/:id */
router.get('/:id', requireAuth, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(Number(req.params.id));
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!isMember(group.id, req.user.id)) return res.status(403).json({ error: 'Not a member' });
  res.json({ group: groupPayload(group, req.user.id) });
});

/** POST /api/groups/:id/members */
router.post('/:id/members', requireAuth, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(Number(req.params.id));
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!isMember(group.id, req.user.id)) return res.status(403).json({ error: 'Not a member' });

  const u = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(String((req.body && req.body.username) || '').toLowerCase());
  if (!u) return res.status(404).json({ error: 'User not found' });

  db.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')").run(
    group.id,
    u.id
  );
  realtime.emitToUser(u.id, 'group:new', { group: groupPayload(group, null) });
  realtime.emitToUsers(memberIds(group.id), 'group:member_added', {
    groupId: group.id,
    user: brief(u),
  });
  res.json({ group: groupPayload(group, req.user.id) });
});

/** DELETE /api/groups/:id/members/:username */
router.delete('/:id/members/:username', requireAuth, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(Number(req.params.id));
  if (!group) return res.status(404).json({ error: 'Group not found' });
  const target = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(String(req.params.username).toLowerCase());
  if (!target) return res.status(404).json({ error: 'User not found' });

  const isSelf = target.id === req.user.id;
  if (!isSelf && group.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the group owner can remove members' });
  }
  if (target.id === group.owner_id) {
    return res.status(400).json({ error: 'The owner cannot leave the group' });
  }

  db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(group.id, target.id);
  realtime.emitToUser(target.id, 'group:removed', { groupId: group.id });
  res.json({ ok: true });
});

/** GET /api/groups/:id/messages */
router.get('/:id/messages', requireAuth, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(Number(req.params.id));
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!isMember(group.id, req.user.id)) return res.status(403).json({ error: 'Not a member' });

  const rows = db
    .prepare(
      `SELECT m.*, u.username, u.display_name, u.avatar_color
       FROM group_messages m JOIN users u ON u.id = m.sender_id
       WHERE m.group_id = ? ORDER BY m.id ASC LIMIT 300`
    )
    .all(group.id);

  res.json({
    groupId: group.id,
    group: groupPayload(group, req.user.id),
    messages: rows.map((m) => shapeMessage(m, req.user.id)),
  });
});

/** POST /api/groups/:id/messages */
router.post('/:id/messages', requireAuth, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(Number(req.params.id));
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!isMember(group.id, req.user.id)) return res.status(403).json({ error: 'Not a member' });

  const body = (req.body && req.body.body ? String(req.body.body) : '').trim();
  const mediaType = (req.body && req.body.mediaType) || 'none';
  const mediaUrl = (req.body && req.body.mediaUrl) || null;
  if (!body && !mediaUrl) return res.status(400).json({ error: 'Message cannot be empty' });
  if (body.length > 1000) return res.status(400).json({ error: 'Message is limited to 1000 characters' });

  const info = db
    .prepare(
      'INSERT INTO group_messages (group_id, sender_id, body, media_type, media_url) VALUES (?, ?, ?, ?, ?)'
    )
    .run(group.id, req.user.id, body, mediaType, mediaUrl);

  const row = db
    .prepare(
      `SELECT m.*, u.username, u.display_name, u.avatar_color
       FROM group_messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?`
    )
    .get(info.lastInsertRowid);

  const others = memberIds(group.id).filter((id) => id !== req.user.id);
  realtime.emitToUsers(others, 'group:message', {
    groupId: group.id,
    message: shapeMessage(row, null),
  });

  res.status(201).json({ message: shapeMessage(row, req.user.id) });
});

/** DELETE /api/groups/:id — owner only */
router.delete('/:id', requireAuth, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(Number(req.params.id));
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (group.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can delete the group' });
  const members = memberIds(group.id);
  db.prepare('DELETE FROM groups WHERE id = ?').run(group.id);
  realtime.emitToUsers(members, 'group:deleted', { groupId: group.id });
  res.json({ ok: true });
});

module.exports = { router, memberIds, brief };
