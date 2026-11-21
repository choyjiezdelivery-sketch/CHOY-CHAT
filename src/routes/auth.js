'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, publicUser, requireAuth } = require('../auth');

const router = express.Router();

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', (req, res) => {
  const { username, email, password, displayName } = req.body || {};

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email and password are required' });
  }
  const uname = String(username).trim().toLowerCase();
  const mail = String(email).trim().toLowerCase();

  if (!USERNAME_RE.test(uname)) {
    return res.status(400).json({ error: 'Username must be 3-20 chars: a-z, 0-9, underscore' });
  }
  if (!EMAIL_RE.test(mail)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const clash = db
    .prepare('SELECT id FROM users WHERE username = ? OR email = ?')
    .get(uname, mail);
  if (clash) return res.status(409).json({ error: 'Username or email already taken' });

  const hash = bcrypt.hashSync(String(password), 10);
  const name = (displayName && String(displayName).trim()) || uname;
  const colors = ['#6c5ce7', '#00b894', '#e17055', '#0984e3', '#d63031', '#fdcb6e', '#a29bfe'];
  const color = colors[Math.floor(Math.random() * colors.length)];

  const info = db
    .prepare(
      `INSERT INTO users (username, email, password_hash, display_name, avatar_color)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(uname, mail, hash, name, color);

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ token: signToken(row), user: publicUser(row) });
});

router.post('/login', (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) {
    return res.status(400).json({ error: 'identifier and password are required' });
  }
  const key = String(identifier).trim().toLowerCase();
  const row = db
    .prepare('SELECT * FROM users WHERE username = ? OR email = ?')
    .get(key, key);

  if (!row || !bcrypt.compareSync(String(password), row.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.json({ token: signToken(row), user: publicUser(row) });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
