/**
 * POST /api/users/me/username — change the username.
 * body: { username, pin }
 * Requires the account PIN when one is set.
 */
router.post('/me/username', requireAuth, (req, res) => {
  const next = String((req.body && req.body.username) || '').trim().toLowerCase();
  const pin = req.body && req.body.pin != null ? String(req.body.pin) : '';

  if (!USERNAME_RE.test(next)) {
    return res.status(400).json({ error: 'Username must be 3-20 chars: a-z, 0-9, underscore' });
  }
  if (next === req.user.username) {
    return res.status(400).json({ error: 'That is already your username' });
  }
  if (req.user.pin_hash) {
    if (!pin) {
      return res.status(401).json({ error: 'PIN is required to change your username' });
    }
    if (!verifyPin(pin, req.user.pin_hash)) {
      return res.status(401).json({ error: 'Incorrect PIN' });
    }
  }
  const clash = db.prepare('SELECT id FROM users WHERE username = ?').get(next);
  if (clash) return res.status(409).json({ error: 'That username is taken' });

  db.prepare('UPDATE users SET username = ? WHERE id = ?').run(next, req.user.id);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  // The old token still carries the old username, so hand back a fresh one.
  const { signToken } = require('../auth');
  res.json({ ok: true, user: profilePayload(row, req.user.id), token: signToken(row) });
});
