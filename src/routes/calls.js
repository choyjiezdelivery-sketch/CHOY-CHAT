'use strict';

/**
 * Video / voice calls.
 *
 * The server does not carry the media itself — it is the signalling layer.
 * A call is a row in `calls` plus a set of realtime events that let the two
 * browsers find each other and exchange WebRTC offers/answers/ICE candidates.
 *
 *   POST   /api/calls/start/:username   { kind: 'video'|'audio' }
 *   POST   /api/calls/:id/answer
 *   POST   /api/calls/:id/decline
 *   POST   /api/calls/:id/end
 *   GET    /api/calls/history
 *   GET    /api/calls/:id
 *
 * Signalling relay (client -> server -> other party), over the /ws socket:
 *   call:signal  { callId, signal }   ->  call:signal { callId, from, signal }
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
  };
}

function shapeCall(row) {
  const caller = db.prepare('SELECT * FROM users WHERE id = ?').get(row.caller_id);
  const callee = db.prepare('SELECT * FROM users WHERE id = ?').get(row.callee_id);
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    startedAt: row.started_at,
    answeredAt: row.answered_at,
    endedAt: row.ended_at,
    caller: brief(caller),
    callee: brief(callee),
  };
}

/** POST /api/calls/start/:username */
router.post('/start/:username', requireAuth, (req, res) => {
  const callee = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(String(req.params.username).toLowerCase());
  if (!callee) return res.status(404).json({ error: 'User not found' });
  if (callee.id === req.user.id) return res.status(400).json({ error: 'You cannot call yourself' });

  const kind = (req.body && req.body.kind) === 'audio' ? 'audio' : 'video';

  // Only one ringing call per pair at a time.
  const ringing = db
    .prepare(
      `SELECT * FROM calls
       WHERE status = 'ringing'
         AND ((caller_id = ? AND callee_id = ?) OR (caller_id = ? AND callee_id = ?))`
    )
    .get(req.user.id, callee.id, callee.id, req.user.id);
  if (ringing) return res.json({ call: shapeCall(ringing), reused: true });

  const info = db
    .prepare('INSERT INTO calls (caller_id, callee_id, kind, status) VALUES (?, ?, ?, ?)')
    .run(req.user.id, callee.id, kind, 'ringing');
  const row = db.prepare('SELECT * FROM calls WHERE id = ?').get(info.lastInsertRowid);
  const call = shapeCall(row);

  realtime.emitToUser(callee.id, 'call:incoming', { call });
  createNotification({
    userId: callee.id,
    actorId: req.user.id,
    type: 'call',
    body: `${req.user.display_name} is calling you (${kind})`,
  });

  res.status(201).json({ call });
});

/** GET /api/calls/history */
router.get('/history', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM calls
       WHERE caller_id = ? OR callee_id = ?
       ORDER BY id DESC LIMIT 50`
    )
    .all(req.user.id, req.user.id);
  res.json({ calls: rows.map(shapeCall) });
});

/** GET /api/calls/:id */
router.get('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM calls WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Call not found' });
  if (row.caller_id !== req.user.id && row.callee_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your call' });
  }
  res.json({ call: shapeCall(row) });
});

/** POST /api/calls/:id/answer */
router.post('/:id/answer', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM calls WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Call not found' });
  if (row.callee_id !== req.user.id) return res.status(403).json({ error: 'Only the callee can answer' });
  if (row.status !== 'ringing') return res.status(409).json({ error: `Call is already ${row.status}` });

  db.prepare("UPDATE calls SET status = 'active', answered_at = datetime('now') WHERE id = ?").run(row.id);
  const call = shapeCall(db.prepare('SELECT * FROM calls WHERE id = ?').get(row.id));
  realtime.emitToUser(row.caller_id, 'call:answered', { call });
  res.json({ call });
});

/** POST /api/calls/:id/decline */
router.post('/:id/decline', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM calls WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Call not found' });
  if (row.callee_id !== req.user.id && row.caller_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your call' });
  }
  db.prepare("UPDATE calls SET status = 'declined', ended_at = datetime('now') WHERE id = ?").run(row.id);
  const call = shapeCall(db.prepare('SELECT * FROM calls WHERE id = ?').get(row.id));
  const other = row.caller_id === req.user.id ? row.callee_id : row.caller_id;
  realtime.emitToUser(other, 'call:declined', { call });
  res.json({ call });
});

/** POST /api/calls/:id/end */
router.post('/:id/end', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM calls WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Call not found' });
  if (row.caller_id !== req.user.id && row.callee_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your call' });
  }
  db.prepare("UPDATE calls SET status = 'ended', ended_at = datetime('now') WHERE id = ?").run(row.id);
  const call = shapeCall(db.prepare('SELECT * FROM calls WHERE id = ?').get(row.id));
  const other = row.caller_id === req.user.id ? row.callee_id : row.caller_id;
  realtime.emitToUser(other, 'call:ended', { call });
  res.json({ call });
});

module.exports = router;
