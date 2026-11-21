'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

const SECRET = process.env.JWT_SECRET || 'choy-chat-dev-secret-change-me';
const TOKEN_TTL = process.env.JWT_TTL || '7d';

function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username, role: user.role || 'user' }, SECRET, {
    expiresIn: TOKEN_TTL,
  });
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    avatarColor: row.avatar_color,
    avatarUrl: row.avatar_url || null,
    coverUrl: row.cover_url || null,
    location: row.location,
    website: row.website,
    role: row.role || 'user',
    hasPin: !!row.pin_hash,
    isBanned: !!row.is_banned,
    lastSeen: row.last_seen || null,
    createdAt: row.created_at,
  };
}

function readToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/** Attaches req.user when a valid token is present. Never rejects. */
function optionalAuth(req, _res, next) {
  const token = readToken(req);
  if (token) {
    try {
      const payload = jwt.verify(token, SECRET);
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
      if (row) req.user = row;
    } catch (_err) {
      /* ignore invalid token */
    }
  }
  next();
}

/** Rejects with 401 when no valid token is present. */
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.is_banned) return res.status(403).json({ error: 'This account is suspended' });
  next();
}

/** Rejects unless the signed-in user is an admin. */
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if ((req.user.role || 'user') !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function hashPin(pin) {
  return bcrypt.hashSync(String(pin), 10);
}

function verifyPin(pin, hash) {
  if (!hash) return false;
  return bcrypt.compareSync(String(pin), hash);
}

module.exports = {
  signToken,
  publicUser,
  optionalAuth,
  requireAuth,
  requireAdmin,
  hashPin,
  verifyPin,
  SECRET,
};
