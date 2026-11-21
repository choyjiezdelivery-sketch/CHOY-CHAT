'use strict';

/**
 * Live GPS.
 *
 *   POST   /api/gps            { lat, lng, accuracy }  publish my position
 *   GET    /api/gps            friends' live positions (only those sharing)
 *   GET    /api/gps/me         my last known position
 *   POST   /api/gps/sharing    { sharing: true|false }
 *   DELETE /api/gps            stop sharing and forget my position
 *
 * Positions are only ever returned to people who are friends with the sharer,
 * and only while that person has sharing switched on.
 */

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const realtime = require('../realtime');
const { friendIds } = require('./friends');

const router = express.Router();

function brief(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
    avatarUrl: row.avatar_url || null,
  };
}

function shapeLocation(row) {
  return {
    user: brief(row),
    lat: row.lat,
    lng: row.lng,
    accuracy: row.accuracy,
    updatedAt: row.updated_at,
  };
}

/** POST /api/gps — publish my position */
router.post('/', requireAuth, (req, res) => {
  const lat = Number(req.body && req.body.lat);
  const lng = Number(req.body && req.body.lng);
  const accuracy = req.body && req.body.accuracy != null ? Number(req.body.accuracy) : null;

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return res.status(400).json({ error: 'lat must be a number between -90 and 90' });
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'lng must be a number between -180 and 180' });
  }

  db.prepare(
    `INSERT INTO gps_locations (user_id, lat, lng, accuracy, sharing, updated_at)
     VALUES (?, ?, ?, ?, 1, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       lat = excluded.lat,
       lng = excluded.lng,
       accuracy = excluded.accuracy,
       updated_at = datetime('now')`
  ).run(req.user.id, lat, lng, accuracy);

  const payload = {
    user: brief(req.user),
    lat,
    lng,
    accuracy,
    updatedAt: new Date().toISOString(),
  };

  // Friends watching the map get the pin move live.
  realtime.emitToUsers(friendIds(req.user.id), 'gps:update', payload);
  res.json({ location: payload });
});

/** GET /api/gps — friends' live positions */
router.get('/', requireAuth, (req, res) => {
  const ids = friendIds(req.user.id);
  if (!ids.length) return res.json({ locations: [] });
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT g.*, u.username, u.display_name, u.avatar_color, u.avatar_url
       FROM gps_locations g JOIN users u ON u.id = g.user_id
       WHERE g.sharing = 1 AND g.user_id IN (${placeholders})
       ORDER BY g.updated_at DESC`
    )
    .all(...ids);
  res.json({ locations: rows.map(shapeLocation) });
});

/** GET /api/gps/me */
router.get('/me', requireAuth, (req, res) => {
  const row = db
    .prepare(
      `SELECT g.*, u.username, u.display_name, u.avatar_color, u.avatar_url
       FROM gps_locations g JOIN users u ON u.id = g.user_id
       WHERE g.user_id = ?`
    )
    .get(req.user.id);
  if (!row) return res.json({ location: null });
  res.json({ location: { ...shapeLocation(row), sharing: !!row.sharing } });
});

/** POST /api/gps/sharing — toggle sharing */
router.post('/sharing', requireAuth, (req, res) => {
  const sharing = req.body && req.body.sharing ? 1 : 0;
  const existing = db.prepare('SELECT 1 FROM gps_locations WHERE user_id = ?').get(req.user.id);
  if (existing) {
    db.prepare("UPDATE gps_locations SET sharing = ?, updated_at = datetime('now') WHERE user_id = ?").run(
      sharing,
      req.user.id
    );
  }
  if (!sharing) {
    realtime.emitToUsers(friendIds(req.user.id), 'gps:offline', { userId: req.user.id });
  }
  res.json({ sharing: !!sharing });
});

/** DELETE /api/gps — stop sharing and forget my position */
router.delete('/', requireAuth, (req, res) => {
  db.prepare('DELETE FROM gps_locations WHERE user_id = ?').run(req.user.id);
  realtime.emitToUsers(friendIds(req.user.id), 'gps:offline', { userId: req.user.id });
  res.json({ ok: true });
});

module.exports = router;
