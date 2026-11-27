'use strict';

/**
 * First-run bootstrap.
 *
 * Runs on every boot, but is idempotent: it only creates data when the database
 * is empty. This is what makes a persistent disk safe — a redeploy restarts the
 * process against the existing database and nothing is touched.
 *
 * Why this exists: the original render.yaml ran `npm run seed` as the *build*
 * command. Two things were wrong with that:
 *
 *   1. Render's build step runs before the persistent disk is mounted, so the
 *      seed wrote to a throwaway path and the real database was never created.
 *   2. `seed.js` deletes and recreates every demo user, so running it on each
 *      deploy would have wiped real accounts and posts.
 *
 * So seeding moved here, behind an emptiness check, and runs at start time when
 * the disk is actually mounted.
 */

const bcrypt = require('bcryptjs');
const db = require('./db');
const { hashPin } = require('./auth');

const DEMO_PASSWORD = 'password123';

const DEMO_USERS = [
  { username: 'choy', email: 'choy@example.com', displayName: 'Choy', bio: 'Building CHOY-CHAT. Coffee, code, cameras.', color: '#6c5ce7', role: 'admin' },
  { username: 'maya', email: 'maya@example.com', displayName: 'Maya Reyes', bio: 'Photographer. Chasing light.', color: '#00b894' },
  { username: 'juan', email: 'juan@example.com', displayName: 'Juan Dela Cruz', bio: 'Music producer', color: '#e17055' },
  { username: 'ana', email: 'ana@example.com', displayName: 'Ana Lim', bio: 'Travel + food.', color: '#0984e3' },
  { username: 'ben', email: 'ben@example.com', displayName: 'Ben Tan', bio: 'Runner. Reader.', color: '#d63031' },
];

const DEMO_POSTS = [
  { by: 'choy', body: 'Welcome to CHOY-CHAT. This is the first post on the new feed.' },
  { by: 'maya', body: 'Golden hour at the bay. No filter needed.' },
  { by: 'juan', body: 'New beat finished at 3am. Worth it.' },
  { by: 'ana', body: 'Street food crawl this weekend — who is in?' },
  { by: 'ben', body: '10k before sunrise. Legs are done.' },
  { by: 'choy', body: 'Shipped realtime messages today. Try opening two windows.' },
];

function userCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

/** Create the demo dataset. Only ever called on an empty database. */
function seedDemoData() {
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const ids = {};

  const insertUser = db.prepare(
    `INSERT INTO users (username, email, password_hash, display_name, bio, avatar_color, role, location)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const u of DEMO_USERS) {
    ids[u.username] = insertUser.run(
      u.username, u.email, hash, u.displayName, u.bio, u.color, u.role || 'user', 'Manila, PH'
    ).lastInsertRowid;
  }

  const follow = db.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)');
  for (const [a, b] of [
    ['choy', 'maya'], ['choy', 'juan'], ['maya', 'choy'], ['juan', 'choy'],
    ['ana', 'choy'], ['ben', 'choy'], ['maya', 'ana'], ['ana', 'maya'],
  ]) follow.run(ids[a], ids[b]);

  const friend = db.prepare(
    "INSERT OR IGNORE INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, 'accepted')"
  );
  friend.run(ids.choy, ids.maya);
  friend.run(ids.choy, ids.juan);
  friend.run(ids.maya, ids.ana);
  db.prepare(
    "INSERT OR IGNORE INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, 'pending')"
  ).run(ids.ben, ids.choy);

  const insertPost = db.prepare('INSERT INTO posts (user_id, body) VALUES (?, ?)');
  const postIds = DEMO_POSTS.map((p) => insertPost.run(ids[p.by], p.body).lastInsertRowid);

  const like = db.prepare('INSERT OR IGNORE INTO likes (user_id, post_id) VALUES (?, ?)');
  like.run(ids.maya, postIds[0]);
  like.run(ids.juan, postIds[0]);
  like.run(ids.choy, postIds[1]);
  like.run(ids.ana, postIds[1]);
  like.run(ids.choy, postIds[2]);

  const comment = db.prepare('INSERT INTO comments (post_id, user_id, body) VALUES (?, ?, ?)');
  comment.run(postIds[0], ids.maya, 'Congrats on the launch!');
  comment.run(postIds[0], ids.juan, 'Clean UI.');
  comment.run(postIds[1], ids.ana, 'That light is unreal.');

  const [a, b] = ids.choy < ids.maya ? [ids.choy, ids.maya] : [ids.maya, ids.choy];
  const conv = db.prepare('INSERT OR IGNORE INTO conversations (user_a, user_b) VALUES (?, ?)').run(a, b);
  const convId = conv.lastInsertRowid ||
    db.prepare('SELECT id FROM conversations WHERE user_a = ? AND user_b = ?').get(a, b).id;

  const msg = db.prepare('INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, ?, ?)');
  msg.run(convId, ids.maya, 'Hey Choy! The new feed looks great.');
  msg.run(convId, ids.choy, 'Thanks Maya! Realtime is live now too.');
  msg.run(convId, ids.maya, 'Nice — testing it now');

  const gid = db.prepare('INSERT INTO groups (name, owner_id, avatar_color) VALUES (?, ?, ?)')
    .run('Weekend Trip', ids.choy, '#00b894').lastInsertRowid;
  const gm = db.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)");
  gm.run(gid, ids.choy, 'owner');
  gm.run(gid, ids.maya, 'member');
  gm.run(gid, ids.juan, 'member');
  const gmsg = db.prepare('INSERT INTO group_messages (group_id, sender_id, body) VALUES (?, ?, ?)');
  gmsg.run(gid, ids.choy, 'Who is driving on Saturday?');
  gmsg.run(gid, ids.maya, 'I can drive — 7am pickup?');

  const gps = db.prepare(
    `INSERT INTO gps_locations (user_id, lat, lng, accuracy, sharing, updated_at)
     VALUES (?, ?, ?, ?, 1, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, updated_at = datetime('now')`
  );
  gps.run(ids.maya, 14.5995, 120.9842, 12);
  gps.run(ids.juan, 14.6091, 121.0223, 20);

  console.log(`[bootstrap] seeded ${DEMO_USERS.length} demo users, ${DEMO_POSTS.length} posts`);
}

/**
 * Make sure the account named by ADMIN_USERNAME exists and is an admin.
 *
 * If the database is empty and ADMIN_USERNAME is set, this creates that account
 * with ADMIN_PASSWORD (or the demo password) so a fresh deploy always has a way
 * in. If the account already exists it is only promoted, never overwritten —
 * so changing the password later is not undone by a redeploy.
 */
function ensureAdmin() {
  const username = (process.env.ADMIN_USERNAME || '').trim().toLowerCase();
  if (!username) return;

  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!existing) {
    const password = process.env.ADMIN_PASSWORD || DEMO_PASSWORD;
    const email = process.env.ADMIN_EMAIL || `${username}@example.com`;
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(
      `INSERT INTO users (username, email, password_hash, display_name, avatar_color, role, location)
       VALUES (?, ?, ?, ?, ?, 'admin', '')`
    ).run(username, email, hash, username, '#6c5ce7');
    console.log(`[bootstrap] created admin account @${username}`);
  } else if (existing.role !== 'admin') {
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(existing.id);
    console.log(`[bootstrap] promoted @${username} to admin`);
  }

  const pin = process.env.ADMIN_PIN;
  if (pin && /^\d{4,8}$/.test(String(pin))) {
    db.prepare(
      `INSERT INTO settings (key, value, is_secret, updated_at)
       VALUES ('ADMIN_PIN', ?, 1, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(hashPin(String(pin)));
    console.log('[bootstrap] admin PIN configured');
  } else if (pin) {
    console.warn('[bootstrap] ADMIN_PIN ignored — it must be 4 to 8 digits');
  }
}

/**
 * Run the whole bootstrap. Safe to call on every boot.
 * @returns {{seeded: boolean, users: number}}
 */
function bootstrap() {
  const before = userCount();
  let seeded = false;

  if (before === 0) {
    // BOOTSTRAP_DEMO_DATA=false gives a clean production database with only
    // the admin account, no demo posts.
    if (String(process.env.BOOTSTRAP_DEMO_DATA || 'true').toLowerCase() !== 'false') {
      seedDemoData();
      seeded = true;
    }
  } else {
    console.log(`[bootstrap] database already has ${before} users — leaving it alone`);
  }

  ensureAdmin();

  return { seeded, users: userCount() };
}

module.exports = { bootstrap, seedDemoData, ensureAdmin, DEMO_PASSWORD };

// Allow `node src/bootstrap.js` as a manual one-off.
if (require.main === module) {
  const result = bootstrap();
  console.log(`[bootstrap] done — ${result.users} users`);
}
