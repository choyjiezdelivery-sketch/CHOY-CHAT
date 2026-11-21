'use strict';

/**
 * Admin dashboard API. Every route here requires role = 'admin'.
 *
 *   GET    /api/admin/overview              counts + health
 *   GET    /api/admin/users                 list / search users
 *   PATCH  /api/admin/users/:id             role, ban, verify
 *   DELETE /api/admin/users/:id             delete a user
 *   GET    /api/admin/posts                 list / search posts
 *   DELETE /api/admin/posts/:id             delete any post
 *   GET    /api/admin/settings              all settings (secrets masked)
 *   PUT    /api/admin/settings              upsert settings
 *   DELETE /api/admin/settings/:key
 *   GET    /api/admin/env                   required env vars + where to get them
 *   GET    /api/admin/audit                 audit log
 *   GET    /api/admin/security              Security Studio posture + checks
 *   POST   /api/admin/github/commit         commit files to the repo
 *   GET    /api/admin/github/status         repo + branch status
 *   POST   /api/admin/supabase/test         test the Supabase connection
 */

const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin, publicUser } = require('../auth');
const realtime = require('../realtime');

const router = express.Router();

router.use(requireAuth, requireAdmin);

/* ------------------------------------------------------------------ helpers */

function audit(actorId, action, detail, req) {
  db.prepare('INSERT INTO audit_log (actor_id, action, detail, ip) VALUES (?, ?, ?, ?)').run(
    actorId,
    action,
    detail,
    (req && (req.ip || req.headers['x-forwarded-for'])) || null
  );
}

function getSetting(key) {
  const row = db.prepare('SELECT * FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function mask(value) {
  if (!value) return null;
  const s = String(value);
  if (s.length <= 8) return '••••••••';
  return `${s.slice(0, 4)}••••••••${s.slice(-4)}`;
}

/* --------------------------------------------------------------- overview */

router.get('/overview', (req, res) => {
  const one = (sql, ...args) => db.prepare(sql).get(...args).c;
  res.json({
    counts: {
      users: one('SELECT COUNT(*) AS c FROM users'),
      admins: one("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'"),
      banned: one('SELECT COUNT(*) AS c FROM users WHERE is_banned = 1'),
      posts: one('SELECT COUNT(*) AS c FROM posts'),
      comments: one('SELECT COUNT(*) AS c FROM comments'),
      likes: one('SELECT COUNT(*) AS c FROM likes'),
      messages: one('SELECT COUNT(*) AS c FROM messages'),
      groups: one('SELECT COUNT(*) AS c FROM groups'),
      friendships: one("SELECT COUNT(*) AS c FROM friendships WHERE status = 'accepted'"),
      pendingRequests: one("SELECT COUNT(*) AS c FROM friendships WHERE status = 'pending'"),
      calls: one('SELECT COUNT(*) AS c FROM calls'),
      gpsSharing: one('SELECT COUNT(*) AS c FROM gps_locations WHERE sharing = 1'),
    },
    realtime: {
      connections: realtime.connectionCount(),
      onlineUsers: realtime.onlineUserIds().length,
    },
    server: {
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      now: new Date().toISOString(),
    },
  });
});

/* ------------------------------------------------------------------ users */

router.get('/users', (req, res) => {
  const q = (req.query.q || '').toString().trim().toLowerCase();
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = q
    ? db
        .prepare(
          `SELECT * FROM users
           WHERE lower(username) LIKE ? OR lower(display_name) LIKE ? OR lower(email) LIKE ?
           ORDER BY id DESC LIMIT ?`
        )
        .all(`%${q}%`, `%${q}%`, `%${q}%`, limit)
    : db.prepare('SELECT * FROM users ORDER BY id DESC LIMIT ?').all(limit);

  res.json({
    users: rows.map((r) => ({
      ...publicUser(r),
      email: r.email,
      postCount: db.prepare('SELECT COUNT(*) AS c FROM posts WHERE user_id = ?').get(r.id).c,
      followerCount: db.prepare('SELECT COUNT(*) AS c FROM follows WHERE followee_id = ?').get(r.id).c,
    })),
  });
});

router.patch('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'User not found' });

  const { role, isBanned } = req.body || {};
  if (role !== undefined) {
    if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'role must be user or admin' });
    if (id === req.user.id && role !== 'admin') {
      return res.status(400).json({ error: 'You cannot remove your own admin role' });
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }
  if (isBanned !== undefined) {
    if (id === req.user.id) return res.status(400).json({ error: 'You cannot ban yourself' });
    db.prepare('UPDATE users SET is_banned = ? WHERE id = ?').run(isBanned ? 1 : 0, id);
  }

  audit(req.user.id, 'user.update', `user #${id} role=${role ?? '-'} banned=${isBanned ?? '-'}`, req);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({ user: { ...publicUser(updated), email: updated.email } });
});

router.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account here' });
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'User not found' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  audit(req.user.id, 'user.delete', `deleted @${row.username} (#${id})`, req);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ posts */

router.get('/posts', (req, res) => {
  const q = (req.query.q || '').toString().trim().toLowerCase();
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = q
    ? db
        .prepare(
          `SELECT p.*, u.username, u.display_name FROM posts p JOIN users u ON u.id = p.user_id
           WHERE lower(p.body) LIKE ? OR lower(u.username) LIKE ?
           ORDER BY p.id DESC LIMIT ?`
        )
        .all(`%${q}%`, `%${q}%`, limit)
    : db
        .prepare(
          `SELECT p.*, u.username, u.display_name FROM posts p JOIN users u ON u.id = p.user_id
           ORDER BY p.id DESC LIMIT ?`
        )
        .all(limit);

  res.json({
    posts: rows.map((p) => ({
      id: p.id,
      body: p.body,
      mediaType: p.media_type,
      mediaUrl: p.media_url,
      createdAt: p.created_at,
      author: { id: p.user_id, username: p.username, displayName: p.display_name },
      likeCount: db.prepare('SELECT COUNT(*) AS c FROM likes WHERE post_id = ?').get(p.id).c,
      commentCount: db.prepare('SELECT COUNT(*) AS c FROM comments WHERE post_id = ?').get(p.id).c,
    })),
  });
});

router.delete('/posts/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Post not found' });
  db.prepare('DELETE FROM posts WHERE id = ?').run(id);
  realtime.broadcast('post:deleted', { postId: id });
  audit(req.user.id, 'post.delete', `deleted post #${id}`, req);
  res.json({ ok: true });
});

/* --------------------------------------------------------------- settings */

router.get('/settings', (_req, res) => {
  const rows = db.prepare('SELECT * FROM settings ORDER BY key').all();
  res.json({
    settings: rows.map((r) => ({
      key: r.key,
      value: r.is_secret ? mask(r.value) : r.value,
      isSecret: !!r.is_secret,
      hasValue: !!r.value,
      updatedAt: r.updated_at,
    })),
  });
});

router.put('/settings', (req, res) => {
  const items = Array.isArray(req.body && req.body.settings) ? req.body.settings : [];
  if (!items.length) return res.status(400).json({ error: 'settings array is required' });

  const stmt = db.prepare(
    `INSERT INTO settings (key, value, is_secret, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       is_secret = excluded.is_secret,
       updated_at = datetime('now')`
  );

  const saved = [];
  for (const item of items) {
    if (!item || !item.key) continue;
    const key = String(item.key).slice(0, 80);
    const isSecret = item.isSecret ? 1 : 0;
    // A masked value coming back from the UI means "leave it alone".
    if (isSecret && typeof item.value === 'string' && item.value.includes('••')) continue;
    stmt.run(key, item.value == null ? null : String(item.value), isSecret);
    saved.push(key);
  }

  audit(req.user.id, 'settings.update', `saved: ${saved.join(', ') || 'none'}`, req);
  res.json({ ok: true, saved });
});

router.delete('/settings/:key', (req, res) => {
  db.prepare('DELETE FROM settings WHERE key = ?').run(String(req.params.key));
  audit(req.user.id, 'settings.delete', `deleted ${req.params.key}`, req);
  res.json({ ok: true });
});

/* ------------------------------------------------------- env var reference */

/**
 * The single source of truth for "what do I need to configure, and where do I
 * get it". The admin dashboard renders this table directly.
 */
const ENV_REFERENCE = [
  {
    key: 'PORT',
    required: false,
    secret: false,
    default: '3000',
    what: 'Port the server listens on.',
    where: 'You choose it. Most hosts (Render, Railway, Fly) set it for you.',
    link: null,
  },
  {
    key: 'JWT_SECRET',
    required: true,
    secret: true,
    default: null,
    what: 'Signs login tokens. Anyone with this value can forge a session — keep it private and unique per deployment.',
    where: 'Generate one yourself: run `node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"` and paste the output.',
    link: null,
  },
  {
    key: 'DB_PATH',
    required: false,
    secret: false,
    default: 'data/choy-chat.db',
    what: 'Where the SQLite database file lives. Use a path on a persistent volume in production.',
    where: 'You choose it. On Render/Railway mount a disk and point this at it, e.g. /var/data/choy-chat.db',
    link: null,
  },
  {
    key: 'UPLOAD_DIR',
    required: false,
    secret: false,
    default: 'uploads',
    what: 'Where uploaded images, video and audio are written when using local storage.',
    where: 'You choose it. Point it at a persistent volume, e.g. /var/data/uploads',
    link: null,
  },
  {
    key: 'UPLOAD_MAX_BYTES',
    required: false,
    secret: false,
    default: '26214400',
    what: 'Largest single upload accepted, in bytes (default 25 MB).',
    where: 'You choose it.',
    link: null,
  },
  {
    key: 'SUPABASE_URL',
    required: false,
    secret: false,
    default: null,
    what: 'Your Supabase project URL. Needed only if you want media stored in Supabase Storage instead of local disk.',
    where: 'Supabase dashboard → Project Settings → Data API → Project URL.',
    link: 'https://app.supabase.com/project/_/settings/api',
  },
  {
    key: 'SUPABASE_SERVICE_ROLE_KEY',
    required: false,
    secret: true,
    default: null,
    what: 'Supabase service_role key. Server-side only — it bypasses row-level security, so never expose it to the browser.',
    where: 'Supabase dashboard → Project Settings → API keys → service_role (reveal).',
    link: 'https://app.supabase.com/project/_/settings/api',
  },
  {
    key: 'SUPABASE_ANON_KEY',
    required: false,
    secret: false,
    default: null,
    what: 'Supabase anon/public key. Safe for the browser; used for read-only client access.',
    where: 'Supabase dashboard → Project Settings → API keys → anon / public.',
    link: 'https://app.supabase.com/project/_/settings/api',
  },
  {
    key: 'SUPABASE_BUCKET',
    required: false,
    secret: false,
    default: 'choy-chat-media',
    what: 'The Storage bucket uploads go into. Create it in Supabase Storage and mark it public if you want direct media URLs.',
    where: 'Supabase dashboard → Storage → New bucket.',
    link: 'https://app.supabase.com/project/_/storage/buckets',
  },
  {
    key: 'GITHUB_TOKEN',
    required: false,
    secret: true,
    default: null,
    what: 'Personal access token used by the admin dashboard to commit files to your repository.',
    where: 'GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token. Give it "Contents: Read and write" on the CHOY-CHAT repository.',
    link: 'https://github.com/settings/tokens',
  },
  {
    key: 'GITHUB_REPO',
    required: false,
    secret: false,
    default: 'choyjiezdelivery-sketch/CHOY-CHAT',
    what: 'The repository the admin dashboard commits to, as owner/name.',
    where: 'It is the repo you are looking at.',
    link: 'https://github.com/choyjiezdelivery-sketch/CHOY-CHAT',
  },
  {
    key: 'GITHUB_BRANCH',
    required: false,
    secret: false,
    default: 'main',
    what: 'Branch the admin dashboard commits to.',
    where: 'You choose it.',
    link: null,
  },
  {
    key: 'ADMIN_USERNAME',
    required: false,
    secret: false,
    default: null,
    what: 'Username that is promoted to admin automatically on first boot.',
    where: 'You choose it — use your own CHOY-CHAT username.',
    link: null,
  },
  {
    key: 'ADMIN_PIN',
    required: false,
    secret: true,
    default: null,
    what: 'Optional PIN required to open the admin dashboard, on top of being an admin.',
    where: 'You choose it (4-8 digits).',
    link: null,
  },
];

router.get('/env', (_req, res) => {
  const rows = ENV_REFERENCE.map((item) => {
    const fromEnv = process.env[item.key];
    const fromDb = getSetting(item.key);
    const value = fromEnv || fromDb || null;
    return {
      ...item,
      configured: !!value,
      source: fromEnv ? 'environment' : fromDb ? 'dashboard' : null,
      preview: item.secret ? mask(value) : value,
    };
  });
  res.json({ env: rows });
});

/* ------------------------------------------------------------------ audit */

router.get('/audit', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = db
    .prepare(
      `SELECT a.*, u.username FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_id
       ORDER BY a.id DESC LIMIT ?`
    )
    .all(limit);
  res.json({
    entries: rows.map((r) => ({
      id: r.id,
      action: r.action,
      detail: r.detail,
      ip: r.ip,
      createdAt: r.created_at,
      actor: r.username || 'system',
    })),
  });
});

/* --------------------------------------------------------- security studio */

/**
 * GET /api/admin/security
 * The data behind the Security Studio panel: account hardening status, recent
 * sign-in activity, live sessions and the security-relevant settings.
 */
router.get('/security', (req, res) => {
  const users = db.prepare('SELECT * FROM users').all();
  const withPin = users.filter((u) => u.pin_hash).length;
  const admins = users.filter((u) => u.role === 'admin').length;
  const banned = users.filter((u) => u.is_banned).length;

  const recentLogins = db
    .prepare(
      `SELECT a.*, u.username FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.action LIKE 'auth.%' OR a.action LIKE 'security.%'
       ORDER BY a.id DESC LIMIT 25`
    )
    .all();

  const jwtSecret = process.env.JWT_SECRET || '';
  const weakSecret = !jwtSecret || jwtSecret === 'choy-chat-dev-secret-change-me' || jwtSecret.length < 32;

  res.json({
    posture: {
      totalUsers: users.length,
      admins,
      banned,
      usersWithPin: withPin,
      usersWithoutPin: users.length - withPin,
      jwtSecretConfigured: !!jwtSecret,
      jwtSecretWeak: weakSecret,
      adminPinConfigured: !!getSetting('ADMIN_PIN'),
      httpsOnly: process.env.FORCE_HTTPS === 'true',
      uploadLimitMb: Math.round((Number(process.env.UPLOAD_MAX_BYTES) || 25 * 1024 * 1024) / 1024 / 1024),
    },
    checks: [
      {
        id: 'jwt-secret',
        label: 'JWT secret is strong',
        ok: !weakSecret,
        detail: weakSecret
          ? 'JWT_SECRET is missing, the default, or shorter than 32 chars. Generate one with: openssl rand -hex 32'
          : 'A custom secret of at least 32 characters is set.',
      },
      {
        id: 'admin-pin',
        label: 'Admin PIN is set',
        ok: !!getSetting('ADMIN_PIN'),
        detail: getSetting('ADMIN_PIN')
          ? 'The admin dashboard is protected by a PIN.'
          : 'No ADMIN_PIN is configured. Set one to require a PIN for admin actions.',
      },
      {
        id: 'banned-users',
        label: 'No suspended accounts pending review',
        ok: banned === 0,
        detail: banned ? `${banned} account(s) are currently suspended.` : 'No suspended accounts.',
      },
      {
        id: 'pin-coverage',
        label: 'All accounts have a PIN',
        ok: users.length > 0 && withPin === users.length,
        detail: `${withPin} of ${users.length} accounts have a PIN set.`,
      },
    ],
    sessions: realtime.onlineUserIds().map((id) => {
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      return {
        userId: id,
        username: u ? u.username : null,
        displayName: u ? u.display_name : null,
        role: u ? u.role : null,
        connections: realtime.connectionCount(),
      };
    }),
    recentActivity: recentLogins.map((r) => ({
      id: r.id,
      action: r.action,
      detail: r.detail,
      ip: r.ip,
      actor: r.username || 'system',
      createdAt: r.created_at,
    })),
  });
});

/* ----------------------------------------------------------------- github */

function githubConfig() {
  return {
    token: process.env.GITHUB_TOKEN || getSetting('GITHUB_TOKEN'),
    repo: process.env.GITHUB_REPO || getSetting('GITHUB_REPO') || 'choyjiezdelivery-sketch/CHOY-CHAT',
    branch: process.env.GITHUB_BRANCH || getSetting('GITHUB_BRANCH') || 'main',
  };
}

async function gh(path, options = {}) {
  const { token } = githubConfig();
  if (!token) {
    const err = new Error('GITHUB_TOKEN is not configured. Add it in Admin → Settings.');
    err.status = 400;
    throw err;
  }
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'choy-chat-admin',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_err) {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error((body && body.message) || `GitHub API error ${res.status}`);
    err.status = res.status;
    err.detail = body;
    throw err;
  }
  return body;
}

router.get('/github/status', async (req, res) => {
  const cfg = githubConfig();
  if (!cfg.token) {
    return res.json({
      configured: false,
      repo: cfg.repo,
      branch: cfg.branch,
      message: 'GITHUB_TOKEN is not set. Add it in Admin → Settings to enable commits.',
    });
  }
  try {
    const repo = await gh(`/repos/${cfg.repo}`);
    const branch = await gh(`/repos/${cfg.repo}/branches/${cfg.branch}`);
    res.json({
      configured: true,
      repo: repo.full_name,
      url: repo.html_url,
      private: repo.private,
      defaultBranch: repo.default_branch,
      branch: branch.name,
      headCommit: branch.commit.sha,
      headMessage: branch.commit.commit.message,
      headDate: branch.commit.commit.author.date,
    });
  } catch (err) {
    res.status(err.status || 500).json({ configured: true, error: err.message });
  }
});

/**
 * POST /api/admin/github/commit
 * body: { message, files: [{ path, content }], branch? }
 * Commits one or more text files in a single commit.
 */
router.post('/github/commit', async (req, res) => {
  const cfg = githubConfig();
  const message = (req.body && req.body.message) || 'chore: update from CHOY-CHAT admin dashboard';
  const files = Array.isArray(req.body && req.body.files) ? req.body.files : [];
  const branch = (req.body && req.body.branch) || cfg.branch;

  if (!files.length) return res.status(400).json({ error: 'files array is required' });
  for (const f of files) {
    if (!f || !f.path || typeof f.content !== 'string') {
      return res.status(400).json({ error: 'each file needs { path, content }' });
    }
  }

  try {
    const ref = await gh(`/repos/${cfg.repo}/git/ref/heads/${branch}`);
    const baseSha = ref.object.sha;
    const baseCommit = await gh(`/repos/${cfg.repo}/git/commits/${baseSha}`);

    const tree = [];
    for (const f of files) {
      const blob = await gh(`/repos/${cfg.repo}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: f.content, encoding: 'utf-8' }),
      });
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }

    const newTree = await gh(`/repos/${cfg.repo}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }),
    });

    const commit = await gh(`/repos/${cfg.repo}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message, tree: newTree.sha, parents: [baseSha] }),
    });

    await gh(`/repos/${cfg.repo}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha }),
    });

    audit(req.user.id, 'github.commit', `${files.length} file(s) to ${cfg.repo}@${branch}`, req);
    res.json({
      ok: true,
      repo: cfg.repo,
      branch,
      commit: commit.sha,
      url: `https://github.com/${cfg.repo}/commit/${commit.sha}`,
      files: files.map((f) => f.path),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, detail: err.detail || null });
  }
});

/* --------------------------------------------------------------- supabase */

router.post('/supabase/test', async (req, res) => {
  const url = process.env.SUPABASE_URL || getSetting('SUPABASE_URL');
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    getSetting('SUPABASE_SERVICE_ROLE_KEY') ||
    getSetting('SUPABASE_SERVICE_KEY');
  const bucket = process.env.SUPABASE_BUCKET || getSetting('SUPABASE_BUCKET');

  if (!url || !key) {
    return res.status(400).json({
      ok: false,
      error: 'SUPABASE_URL and SUPABASE_SERVICE_KEY must both be set.',
      where: 'Supabase dashboard → Project Settings → API.',
      link: 'https://app.supabase.com/project/_/settings/api',
    });
  }

  try {
    const base = url.replace(/\/+$/, '');
    const r = await fetch(`${base}/storage/v1/bucket`, {
      headers: { Authorization: `Bearer ${key}`, apikey: key },
    });
    const body = await r.json().catch(() => null);
    if (!r.ok) {
      return res.status(r.status).json({ ok: false, error: (body && body.message) || `HTTP ${r.status}` });
    }
    const names = Array.isArray(body) ? body.map((b) => b.name) : [];
    res.json({
      ok: true,
      buckets: names,
      bucketConfigured: bucket || null,
      bucketExists: bucket ? names.includes(bucket) : null,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = { router, ENV_REFERENCE };
