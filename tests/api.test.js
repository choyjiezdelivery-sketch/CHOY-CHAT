'use strict';

/**
 * End-to-end API tests. Runs against an in-memory SQLite database.
 * Run with: npm test
 */
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/server');

let server;
let base;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(() => server && server.close());

async function call(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const alice = { username: 'alice', email: 'alice@test.dev', password: 'password123', displayName: 'Alice A' };
const bob = { username: 'bob', email: 'bob@test.dev', password: 'password123', displayName: 'Bob B' };

let aliceToken;
let bobToken;
let postId;

test('health endpoint responds', async () => {
  const { status, data } = await call('/health');
  assert.equal(status, 200);
  assert.equal(data.ok, true);
});

test('register creates a user and returns a token', async () => {
  const { status, data } = await call('/auth/register', { method: 'POST', body: alice });
  assert.equal(status, 201);
  assert.ok(data.token);
  assert.equal(data.user.username, 'alice');
  assert.equal(data.user.displayName, 'Alice A');
  assert.equal(data.user.password_hash, undefined, 'password hash must never leak');
  aliceToken = data.token;
});

test('register rejects duplicate username', async () => {
  const { status } = await call('/auth/register', { method: 'POST', body: alice });
  assert.equal(status, 409);
});

test('register rejects short password', async () => {
  const { status } = await call('/auth/register', {
    method: 'POST',
    body: { username: 'shorty', email: 's@test.dev', password: '123' },
  });
  assert.equal(status, 400);
});

test('register rejects invalid username characters', async () => {
  const { status } = await call('/auth/register', {
    method: 'POST',
    body: { username: 'Bad Name!', email: 'bad@test.dev', password: 'password123' },
  });
  assert.equal(status, 400);
});

test('second user registers', async () => {
  const { status, data } = await call('/auth/register', { method: 'POST', body: bob });
  assert.equal(status, 201);
  bobToken = data.token;
});

test('login works with username and with email', async () => {
  const byName = await call('/auth/login', {
    method: 'POST',
    body: { identifier: 'alice', password: 'password123' },
  });
  assert.equal(byName.status, 200);
  const byEmail = await call('/auth/login', {
    method: 'POST',
    body: { identifier: 'alice@test.dev', password: 'password123' },
  });
  assert.equal(byEmail.status, 200);
});

test('login rejects wrong password', async () => {
  const { status } = await call('/auth/login', {
    method: 'POST',
    body: { identifier: 'alice', password: 'wrong-password' },
  });
  assert.equal(status, 401);
});

test('/auth/me requires a token', async () => {
  const anon = await call('/auth/me');
  assert.equal(anon.status, 401);
  const authed = await call('/auth/me', { token: aliceToken });
  assert.equal(authed.status, 200);
  assert.equal(authed.data.user.username, 'alice');
});

test('creating a post requires auth', async () => {
  const { status } = await call('/posts', { method: 'POST', body: { body: 'nope' } });
  assert.equal(status, 401);
});

test('create a post', async () => {
  const { status, data } = await call('/posts', {
    method: 'POST',
    token: aliceToken,
    body: { body: 'Hello CHOY-CHAT!' },
  });
  assert.equal(status, 201);
  assert.equal(data.post.body, 'Hello CHOY-CHAT!');
  assert.equal(data.post.author.username, 'alice');
  assert.equal(data.post.likeCount, 0);
  postId = data.post.id;
});

test('empty post is rejected', async () => {
  const { status } = await call('/posts', { method: 'POST', token: aliceToken, body: { body: '   ' } });
  assert.equal(status, 400);
});

test('timeline lists the post', async () => {
  const { status, data } = await call('/posts');
  assert.equal(status, 200);
  assert.ok(data.posts.some((p) => p.id === postId));
});

test('like and unlike a post', async () => {
  const liked = await call(`/posts/${postId}/like`, { method: 'POST', token: bobToken });
  assert.equal(liked.status, 200);
  assert.equal(liked.data.liked, true);
  assert.equal(liked.data.likeCount, 1);

  const again = await call(`/posts/${postId}/like`, { method: 'POST', token: bobToken });
  assert.equal(again.data.likeCount, 1, 'liking twice must not double count');

  const unliked = await call(`/posts/${postId}/like`, { method: 'DELETE', token: bobToken });
  assert.equal(unliked.data.liked, false);
  assert.equal(unliked.data.likeCount, 0);
});

test('comment on a post', async () => {
  const { status, data } = await call(`/posts/${postId}/comments`, {
    method: 'POST',
    token: bobToken,
    body: { body: 'Nice one!' },
  });
  assert.equal(status, 201);
  assert.equal(data.comment.body, 'Nice one!');

  const list = await call(`/posts/${postId}/comments`);
  assert.equal(list.data.comments.length, 1);
  assert.equal(list.data.comments[0].author.username, 'bob');
});

test('commenting notifies the post author', async () => {
  const { data } = await call('/notifications', { token: aliceToken });
  assert.ok(data.notifications.some((n) => n.type === 'comment'));
  assert.ok(data.unread >= 1);
});

test('bookmark and unbookmark', async () => {
  const add = await call(`/posts/${postId}/bookmark`, { method: 'POST', token: bobToken });
  assert.equal(add.data.bookmarked, true);
  const list = await call('/posts/bookmarks', { token: bobToken });
  assert.ok(list.data.posts.some((p) => p.id === postId));
  const remove = await call(`/posts/${postId}/bookmark`, { method: 'DELETE', token: bobToken });
  assert.equal(remove.data.bookmarked, false);
});

test('follow and unfollow', async () => {
  const follow = await call('/users/alice/follow', { method: 'POST', token: bobToken });
  assert.equal(follow.status, 200);
  assert.equal(follow.data.following, true);
  assert.equal(follow.data.counts.followers, 1);

  const profile = await call('/users/alice', { token: bobToken });
  assert.equal(profile.data.user.isFollowing, true);

  const unfollow = await call('/users/alice/follow', { method: 'DELETE', token: bobToken });
  assert.equal(unfollow.data.following, false);
});

test('cannot follow yourself', async () => {
  const { status } = await call('/users/alice/follow', { method: 'POST', token: aliceToken });
  assert.equal(status, 400);
});

test('following feed only shows followed users', async () => {
  await call('/users/alice/follow', { method: 'POST', token: bobToken });
  const { data } = await call('/posts?feed=following', { token: bobToken });
  assert.ok(data.posts.every((p) => p.author.username === 'alice' || p.author.username === 'bob'));
});

test('search finds users and posts', async () => {
  const users = await call('/search?q=ali');
  assert.ok(users.data.users.some((u) => u.username === 'alice'));
  const posts = await call('/search?q=CHOY');
  assert.ok(posts.data.posts.some((p) => p.id === postId));
});

test('direct messages: open conversation, send, read', async () => {
  const open = await call('/messages/open/alice', { method: 'POST', token: bobToken });
  assert.equal(open.status, 200);
  const convId = open.data.conversationId;

  const sent = await call(`/messages/${convId}`, {
    method: 'POST',
    token: bobToken,
    body: { body: 'Hey Alice!' },
  });
  assert.equal(sent.status, 201);

  const thread = await call(`/messages/${convId}`, { token: aliceToken });
  assert.equal(thread.status, 200);
  assert.equal(thread.data.messages.length, 1);
  assert.equal(thread.data.messages[0].body, 'Hey Alice!');
  assert.equal(thread.data.messages[0].mine, false);

  const list = await call('/messages', { token: aliceToken });
  assert.ok(list.data.conversations.some((c) => c.id === convId));
});

test('a third party cannot read someone else\'s conversation', async () => {
  const eve = await call('/auth/register', {
    method: 'POST',
    body: { username: 'eve', email: 'eve@test.dev', password: 'password123' },
  });
  const open = await call('/messages/open/alice', { method: 'POST', token: bobToken });
  const { status } = await call(`/messages/${open.data.conversationId}`, { token: eve.data.token });
  assert.equal(status, 403);
});

test('only the author can delete a post', async () => {
  const denied = await call(`/posts/${postId}`, { method: 'DELETE', token: bobToken });
  assert.equal(denied.status, 403);
  const ok = await call(`/posts/${postId}`, { method: 'DELETE', token: aliceToken });
  assert.equal(ok.status, 200);
  const gone = await call(`/posts/${postId}`);
  assert.equal(gone.status, 404);
});

test('profile update works', async () => {
  const { status, data } = await call('/users/me', {
    method: 'PATCH',
    token: aliceToken,
    body: { bio: 'Testing in progress', location: 'Manila' },
  });
  assert.equal(status, 200);
  assert.equal(data.user.bio, 'Testing in progress');
  assert.equal(data.user.location, 'Manila');
});

test('password change requires the current password', async () => {
  const bad = await call('/users/me/password', {
    method: 'POST',
    token: aliceToken,
    body: { currentPassword: 'nope', newPassword: 'newpassword123' },
  });
  assert.equal(bad.status, 401);

  const good = await call('/users/me/password', {
    method: 'POST',
    token: aliceToken,
    body: { currentPassword: 'password123', newPassword: 'newpassword123' },
  });
  assert.equal(good.status, 200);

  const relogin = await call('/auth/login', {
    method: 'POST',
    body: { identifier: 'alice', password: 'newpassword123' },
  });
  assert.equal(relogin.status, 200);
});

test('unknown API route returns JSON 404', async () => {
  const { status, data } = await call('/does-not-exist');
  assert.equal(status, 404);
  assert.ok(data.error);
});
