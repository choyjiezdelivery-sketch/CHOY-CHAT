'use strict';

/**
 * Demo data. Safe to run repeatedly — it clears the demo users first.
 *
 *   npm run seed
 *
 * Creates 5 users (password123 for all), follows, friendships, posts,
 * comments, likes, a group, a DM thread and a couple of GPS pins.
 */

require('dotenv').config();

const bcrypt = require('bcryptjs');
const db = require('./db');

const PASSWORD = 'password123';
const hash = bcrypt.hashSync(PASSWORD, 10);

const USERS = [
  { username: 'choy', email: 'choy@example.com', displayName: 'Choy', bio: 'Building CHOY-CHAT. Coffee, code, cameras.', color: '#6c5ce7', role: 'admin' },
  { username: 'maya', email: 'maya@example.com', displayName: 'Maya Reyes', bio: 'Photographer. Chasing light.', color: '#00b894' },
  { username: 'juan', email: 'juan@example.com', displayName: 'Juan Dela Cruz', bio: 'Music producer 🎧', color: '#e17055' },
  { username: 'ana', email: 'ana@example.com', displayName: 'Ana Lim', bio: 'Travel + food.', color: '#0984e3' },
  { username: 'ben', email: 'ben@example.com', displayName: 'Ben Tan', bio: 'Runner. Reader.', color: '#d63031' },
];

const POSTS = [
  { by: 'choy', body: 'Welcome to CHOY-CHAT 👋 This is the first post on the new feed.' },
  { by: 'maya', body: 'Golden hour at the bay. No filter needed.' },
  { by: 'juan', body: 'New beat finished at 3am. Worth it.' },
  { by: 'ana', body: 'Street food crawl this weekend — who is in?' },
  { by: 'ben', body: '10k before sunrise. Legs are done.' },
  { by: 'choy', body: 'Shipped realtime messages today. Try opening two windows.' },
];

function main() {
  console.log('Seeding CHOY-CHAT…');

  const usernames = USERS.map((u) => u.username);
  const placeholders = usernames.map(() => '?').join(',');
  db.prepare(`DELETE FROM users WHERE username IN (${placeholders})`).run(...usernames);

  const ids = {};
  const insertUser = db.prepare(
    `INSERT INTO users (username, email, password_hash, display_name, bio, avatar_color, role, location)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const u of USERS) {
    const info = insertUser.run(
      u.username,
      u.email,
      hash,
      u.displayName,
      u.bio,
      u.color,
      u.role || 'user',
      'Manila, PH'
    );
    ids[u.username] = info.lastInsertRowid;
  }

  // follows
  const follow = db.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)');
  const pairs = [
    ['choy', 'maya'], ['choy', 'juan'], ['maya', 'choy'], ['juan', 'choy'],
    ['ana', 'choy'], ['ben', 'choy'], ['maya', 'ana'], ['ana', 'maya'],
  ];
  for (const [a, b] of pairs) follow.run(ids[a], ids[b]);

  // friendships (accepted)
  const friend = db.prepare(
    "INSERT OR IGNORE INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, 'accepted')"
  );
  friend.run(ids.choy, ids.maya);
  friend.run(ids.choy, ids.juan);
  friend.run(ids.maya, ids.ana);
  // one pending request so the Friends page has something to show
  db.prepare("INSERT OR IGNORE INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, 'pending')").run(
    ids.ben,
    ids.choy
  );

  // posts
  const insertPost = db.prepare('INSERT INTO posts (user_id, body) VALUES (?, ?)');
  const postIds = [];
  for (const p of POSTS) {
    postIds.push(insertPost.run(ids[p.by], p.body).lastInsertRowid);
  }

  // likes + comments
  const like = db.prepare('INSERT OR IGNORE INTO likes (user_id, post_id) VALUES (?, ?)');
  like.run(ids.maya, postIds[0]);
  like.run(ids.juan, postIds[0]);
  like.run(ids.choy, postIds[1]);
  like.run(ids.ana, postIds[1]);
  like.run(ids.choy, postIds[2]);

  const comment = db.prepare('INSERT INTO comments (post_id, user_id, body) VALUES (?, ?, ?)');
  comment.run(postIds[0], ids.maya, 'Congrats on the launch! 🎉');
  comment.run(postIds[0], ids.juan, 'Clean UI.');
  comment.run(postIds[1], ids.ana, 'That light is unreal.');

  // a DM thread between choy and maya
  const [a, b] = ids.choy < ids.maya ? [ids.choy, ids.maya] : [ids.maya, ids.choy];
  const conv = db
    .prepare('INSERT OR IGNORE INTO conversations (user_a, user_b) VALUES (?, ?)')
    .run(a, b);
  const convId =
    conv.lastInsertRowid ||
    db.prepare('SELECT id FROM conversations WHERE user_a = ? AND user_b = ?').get(a, b).id;

  const msg = db.prepare('INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, ?, ?)');
  msg.run(convId, ids.maya, 'Hey Choy! The new feed looks great.');
  msg.run(convId, ids.choy, 'Thanks Maya! Realtime is live now too.');
  msg.run(convId, ids.maya, 'Nice — testing it now 👀');

  // a group
  const group = db
    .prepare('INSERT INTO groups (name, owner_id, avatar_color) VALUES (?, ?, ?)')
    .run('Weekend Trip', ids.choy, '#00b894');
  const gid = group.lastInsertRowid;
  const gm = db.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)");
  gm.run(gid, ids.choy, 'owner');
  gm.run(gid, ids.maya, 'member');
  gm.run(gid, ids.juan, 'member');
  db.prepare('INSERT INTO group_messages (group_id, sender_id, body) VALUES (?, ?, ?)').run(
    gid,
    ids.choy,
    'Who is driving on Saturday?'
  );
  db.prepare('INSERT INTO group_messages (group_id, sender_id, body) VALUES (?, ?, ?)').run(
    gid,
    ids.maya,
    'I can drive — 7am pickup?'
  );

  // GPS pins
  const gps = db.prepare(
    `INSERT INTO gps_locations (user_id, lat, lng, accuracy, sharing, updated_at)
     VALUES (?, ?, ?, ?, 1, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, updated_at = datetime('now')`
  );
  gps.run(ids.maya, 14.5995, 120.9842, 12);
  gps.run(ids.juan, 14.6091, 121.0223, 20);

  console.log(`Seeded ${USERS.length} users, ${POSTS.length} posts, 1 group, 1 DM thread.`);
  console.log(`Login with any of: ${usernames.join(', ')} — password: ${PASSWORD}`);
  console.log('@choy is an admin, so the Admin dashboard is visible for that account.');
}

main();
