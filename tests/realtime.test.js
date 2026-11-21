'use strict';

/**
 * Realtime (WebSocket) tests.
 *
 * Boots the real HTTP server on an ephemeral port with an in-memory database,
 * opens genuine WebSocket clients, and asserts that REST actions push the
 * expected events to the right people — and only to them.
 *
 * Run with: npm test
 */

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');

const app = require('../src/server');
const realtime = require('../src/realtime');

let server;
let base;
let wsBase;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.server.listen(0, () => {
      const { port } = server.address();
      base = `http://127.0.0.1:${port}`;
      wsBase = `ws://127.0.0.1:${port}/ws`;
      resolve();
    });
  });
});

test.after(() => {
  realtime.closeRealtime();
  if (server) server.close();
});

/* ------------------------------------------------------------------ helpers */

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

/** A test client that records every event it receives. */
function openSocket(token) {
  const ws = new WebSocket(`${wsBase}?token=${encodeURIComponent(token)}`);
  const events = [];
  const waiters = [];

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (_err) {
      return;
    }
    events.push(msg);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].event === msg.event) {
        waiters[i].resolve(msg.payload);
        waiters.splice(i, 1);
      }
    }
  });

  return {
    ws,
    events,
    /** Resolve with the payload of the next event of this name, consuming it. */
    next(event, timeoutMs = 3000) {
      const idx = events.findIndex((e) => e.event === event);
      if (idx >= 0) return Promise.resolve(events.splice(idx, 1)[0].payload);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Timed out waiting for "${event}"`)),
          timeoutMs
        );
        waiters.push({
          event,
          resolve: (payload) => {
            clearTimeout(timer);
            resolve(payload);
          },
        });
      });
    },
    /** Drop everything buffered so far, so the next assertion sees only new events. */
    drain() {
      events.length = 0;
    },
    has(event) {
      return events.some((e) => e.event === event);
    },
    close() {
      try {
        ws.close();
      } catch (_err) {
        /* ignore */
      }
    },
  };
}

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

/** Wait until every socket from earlier tests has been released. */
async function waitForIdleHub(timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (realtime.connectionCount() !== 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return realtime.connectionCount();
}

// Sockets close asynchronously, so a previous test's disconnect can land after
// the next test has connected. Start every test from a quiet hub.
test.beforeEach(async () => {
  await waitForIdleHub();
});

const users = {
  ana: { username: 'ana', email: 'ana@rt.dev', password: 'password123', displayName: 'Ana' },
  ben: { username: 'ben', email: 'ben@rt.dev', password: 'password123', displayName: 'Ben' },
  cid: { username: 'cid', email: 'cid@rt.dev', password: 'password123', displayName: 'Cid' },
};

const tokens = {};

/* -------------------------------------------------------------------- tests */

test('realtime: setup users', async () => {
  for (const key of Object.keys(users)) {
    const { status, data } = await call('/auth/register', { method: 'POST', body: users[key] });
    assert.equal(status, 201);
    tokens[key] = data.token;
  }
});

test('realtime: health endpoint reports the hub', async () => {
  const { status, data } = await call('/health');
  assert.equal(status, 200);
  assert.equal(data.realtime.path, '/ws');
  assert.equal(typeof data.realtime.connections, 'number');
});

test('realtime: a socket without a token is rejected', async () => {
  const ws = new WebSocket(wsBase);
  const outcome = await new Promise((resolve) => {
    ws.once('open', () => resolve('open'));
    ws.once('error', () => resolve('error'));
    ws.once('unexpected-response', () => resolve('rejected'));
  });
  assert.notEqual(outcome, 'open', 'an unauthenticated socket must not connect');
});

test('realtime: a socket with a bad token is rejected', async () => {
  const ws = new WebSocket(`${wsBase}?token=not-a-real-token`);
  const outcome = await new Promise((resolve) => {
    ws.once('open', () => resolve('open'));
    ws.once('error', () => resolve('error'));
    ws.once('unexpected-response', () => resolve('rejected'));
  });
  assert.notEqual(outcome, 'open');
});

test('realtime: an authenticated socket receives hello', async () => {
  const client = openSocket(tokens.ana);
  await waitForOpen(client.ws);
  const hello = await client.next('hello');
  assert.equal(hello.username, 'ana');
  assert.ok(Array.isArray(hello.online));
  client.close();
});

test('realtime: a new direct message is pushed to the recipient only', async () => {
  const ana = openSocket(tokens.ana);
  const ben = openSocket(tokens.ben);
  const cid = openSocket(tokens.cid);
  await Promise.all([waitForOpen(ana.ws), waitForOpen(ben.ws), waitForOpen(cid.ws)]);
  await Promise.all([ana.next('hello'), ben.next('hello'), cid.next('hello')]);

  const open = await call('/messages/open/ben', { method: 'POST', token: tokens.ana });
  const convId = open.data.conversationId;

  const sent = await call(`/messages/${convId}`, {
    method: 'POST',
    token: tokens.ana,
    body: { body: 'Live hello!' },
  });
  assert.equal(sent.status, 201);

  const payload = await ben.next('message:new');
  assert.equal(payload.conversationId, convId);
  assert.equal(payload.message.body, 'Live hello!');
  assert.equal(payload.message.mine, false, 'the recipient must not see it as their own');
  assert.equal(payload.sender.username, 'ana');

  assert.equal(cid.has('message:new'), false, 'a third party must not receive the message');

  ana.close();
  ben.close();
  cid.close();
});

test('realtime: sending a message also pushes a notification', async () => {
  const ben = openSocket(tokens.ben);
  await waitForOpen(ben.ws);
  await ben.next('hello');

  const open = await call('/messages/open/ben', { method: 'POST', token: tokens.ana });
  await call(`/messages/${open.data.conversationId}`, {
    method: 'POST',
    token: tokens.ana,
    body: { body: 'Second ping' },
  });

  const payload = await ben.next('notification:new');
  assert.equal(payload.notification.type, 'message');
  assert.ok(payload.unread >= 1);
  ben.close();
});

test('realtime: reading a thread notifies the sender', async () => {
  const ana = openSocket(tokens.ana);
  await waitForOpen(ana.ws);
  await ana.next('hello');

  const open = await call('/messages/open/ben', { method: 'POST', token: tokens.ana });
  const convId = open.data.conversationId;
  await call(`/messages/${convId}`, {
    method: 'POST',
    token: tokens.ana,
    body: { body: 'Please read me' },
  });

  await call(`/messages/${convId}`, { token: tokens.ben });

  const payload = await ana.next('message:read');
  assert.equal(payload.conversationId, convId);
  assert.equal(payload.readerId, (await call('/auth/me', { token: tokens.ben })).data.user.id);
  ana.close();
});

test('realtime: typing is relayed to the other participant', async () => {
  const ben = openSocket(tokens.ben);
  await waitForOpen(ben.ws);
  await ben.next('hello');

  const open = await call('/messages/open/ben', { method: 'POST', token: tokens.ana });
  const convId = open.data.conversationId;

  const ana = openSocket(tokens.ana);
  await waitForOpen(ana.ws);
  await ana.next('hello');

  ana.ws.send(JSON.stringify({ type: 'typing', conversationId: convId }));

  const payload = await ben.next('typing');
  assert.equal(payload.conversationId, convId);
  assert.equal(payload.username, 'ana');

  ana.close();
  ben.close();
});

test('realtime: ping is answered with pong', async () => {
  const ana = openSocket(tokens.ana);
  await waitForOpen(ana.ws);
  await ana.next('hello');
  ana.ws.send(JSON.stringify({ type: 'ping' }));
  const pong = await ana.next('pong');
  assert.ok(pong.at);
  ana.close();
});

test('realtime: a new post is broadcast to other users', async () => {
  const ben = openSocket(tokens.ben);
  await waitForOpen(ben.ws);
  await ben.next('hello');

  const created = await call('/posts', {
    method: 'POST',
    token: tokens.ana,
    body: { body: 'Live timeline post' },
  });
  assert.equal(created.status, 201);

  const payload = await ben.next('post:new');
  assert.equal(payload.post.body, 'Live timeline post');
  assert.equal(payload.post.author.username, 'ana');
  ben.close();
});

test('realtime: a like pushes post:like and a notification to the author', async () => {
  const ana = openSocket(tokens.ana);
  await waitForOpen(ana.ws);
  await ana.next('hello');

  const created = await call('/posts', {
    method: 'POST',
    token: tokens.ana,
    body: { body: 'Like me live' },
  });
  const postId = created.data.post.id;

  await call(`/posts/${postId}/like`, { method: 'POST', token: tokens.ben });

  const like = await ana.next('post:like');
  assert.equal(like.postId, postId);
  assert.equal(like.likeCount, 1);
  assert.equal(like.likedBy.username, 'ben');

  const notif = await ana.next('notification:new');
  assert.equal(notif.notification.type, 'like');
  ana.close();
});

test('realtime: a comment pushes post:comment to the author', async () => {
  const ana = openSocket(tokens.ana);
  await waitForOpen(ana.ws);
  await ana.next('hello');

  const created = await call('/posts', {
    method: 'POST',
    token: tokens.ana,
    body: { body: 'Comment on me live' },
  });
  const postId = created.data.post.id;

  await call(`/posts/${postId}/comments`, {
    method: 'POST',
    token: tokens.ben,
    body: { body: 'Live comment' },
  });

  const payload = await ana.next('post:comment');
  assert.equal(payload.postId, postId);
  assert.equal(payload.commentCount, 1);
  assert.equal(payload.comment.body, 'Live comment');
  ana.close();
});

test('realtime: a follow pushes follow:new to the target', async () => {
  const cid = openSocket(tokens.cid);
  await waitForOpen(cid.ws);
  await cid.next('hello');

  await call('/users/cid/follow', { method: 'POST', token: tokens.ana });

  const payload = await cid.next('follow:new');
  assert.equal(payload.follower.username, 'ana');
  assert.equal(payload.counts.followers, 1);
  cid.close();
});

test('realtime: presence is announced when someone connects', async () => {
  const ana = openSocket(tokens.ana);
  await waitForOpen(ana.ws);
  await ana.next('hello');
  ana.drain();

  const ben = openSocket(tokens.ben);
  await waitForOpen(ben.ws);
  await ben.next('hello');

  const payload = await ana.next('presence');
  assert.equal(payload.username, 'ben');
  assert.equal(payload.online, true);

  ana.close();
  ben.close();
});

test('realtime: deleting a post broadcasts post:deleted', async () => {
  const ben = openSocket(tokens.ben);
  await waitForOpen(ben.ws);
  await ben.next('hello');

  const created = await call('/posts', {
    method: 'POST',
    token: tokens.ana,
    body: { body: 'Delete me live' },
  });
  await call(`/posts/${created.data.post.id}`, { method: 'DELETE', token: tokens.ana });

  const payload = await ben.next('post:deleted');
  assert.equal(payload.postId, created.data.post.id);
  ben.close();
});

test('realtime: marking notifications read pushes notification:read', async () => {
  const ana = openSocket(tokens.ana);
  await waitForOpen(ana.ws);
  await ana.next('hello');

  await call('/notifications/read', { method: 'POST', token: tokens.ana });
  const payload = await ana.next('notification:read');
  assert.equal(payload.unread, 0);
  ana.close();
});

test('realtime: the hub tracks and releases connections', async () => {
  const before = await waitForIdleHub();
  assert.equal(before, 0, 'all earlier sockets should have been released');

  const ana = openSocket(tokens.ana);
  await waitForOpen(ana.ws);
  await ana.next('hello');
  assert.equal(realtime.connectionCount(), 1);
  assert.equal(realtime.isOnline((await call('/auth/me', { token: tokens.ana })).data.user.id), true);

  ana.close();
  const after = await waitForIdleHub();
  assert.equal(after, 0);
});
