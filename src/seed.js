'use strict';

/**
 * Seeds demo data so a fresh install has something to look at.
 * Usage: npm run seed
 */
const bcrypt = require('bcryptjs');
const db = require('./db');

const users = [
  ['choy', 'choy@choychat.app', 'Choy', 'Building CHOY-CHAT one commit at a time.', '#6c5ce7', 'Manila, PH'],
  ['maya', 'maya@choychat.app', 'Maya Reyes', 'Photographer. Coffee first.', '#00b894', 'Cebu, PH'],
  ['nico', 'nico@choychat.app', 'Nico Santos', 'Frontend dev, CSS enjoyer.', '#0984e3', 'Davao, PH'],
  ['lea', 'lea@choychat.app', 'Lea Cruz', 'Music, film, and long walks.', '#e17055', 'Baguio, PH'],
];

const posts = [
  ['choy', 'Welcome to CHOY-CHAT! This is the first post on the timeline. Say hi 👋'],
  ['maya', 'Golden hour at the pier today. No filter needed.'],
  ['nico', 'Shipped a dark mode toggle in 20 minutes. Feels illegal.'],
  ['lea', 'Currently looping the same three songs. No regrets.'],
  ['choy', 'Building a social app from scratch is 10% code and 90% deciding what to name things.'],
  ['maya', 'New lens arrived. Expect too many photos of the same tree.'],
];

const hash = bcrypt.hashSync('password123', 10);
const ids = {};

const insertUser = db.prepare(
  `INSERT OR IGNORE INTO users (username, email, password_hash, display_name, bio, avatar_color, location)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

for (const [username, email, name, bio, color, location] of users) {
  insertUser.run(username, email, hash, name, bio, color, location);
  ids[username] = db.prepare('SELECT id FROM users WHERE username = ?').get(username).id;
}

const insertPost = db.prepare('INSERT INTO posts (user_id, body) VALUES (?, ?)');
for (const [username, body] of posts) {
  const exists = db.prepare('SELECT 1 FROM posts WHERE body = ?').get(body);
  if (!exists) insertPost.run(ids[username], body);
}

const follow = db.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)');
follow.run(ids.choy, ids.maya);
follow.run(ids.choy, ids.nico);
follow.run(ids.maya, ids.choy);
follow.run(ids.nico, ids.choy);
follow.run(ids.lea, ids.choy);

const like = db.prepare('INSERT OR IGNORE INTO likes (user_id, post_id) VALUES (?, ?)');
const allPosts = db.prepare('SELECT id FROM posts').all();
for (const p of allPosts) {
  like.run(ids.maya, p.id);
  like.run(ids.nico, p.id);
}

console.log('Seed complete. Demo accounts (password: password123):');
for (const [username] of users) console.log(`  - ${username}`);
