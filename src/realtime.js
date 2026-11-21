'use strict';

/**
 * CHOY-CHAT realtime hub.
 *
 * A single WebSocket endpoint (`/ws`) that every signed-in client connects to.
 * Connections are authenticated with the same JWT the REST API uses, then
 * registered per user id so any route can push an event to a specific person.
 *
 * Wire format (both directions) is JSON:
 *   { "event": "<name>", "payload": { ... }, "at": "<iso>" }
 *
 * Server -> client events
 *   hello              { userId, online }            sent once on connect
 *   presence           { userId, online }            someone connected/disconnected
 *   message:new        { conversationId, message }   a DM arrived
 *   message:read       { conversationId, readerId }  the other side opened the thread
 *   typing             { conversationId, userId, username }
 *   notification:new   { notification, unread }
 *   notification:read  { unread }
 *   notification:clear { unread }
 *   post:new           { post }                      new post on the timeline
 *   post:like          { postId, likeCount, likedBy }
 *   post:comment       { postId, commentCount, comment }
 *   post:deleted       { postId }
 *   follow:new         { follower, counts }
 *
 * Client -> server events
 *   ping               -> replies pong
 *   typing             { conversationId }            relayed to the other participant
 */

const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { SECRET } = require('./auth');

const HEARTBEAT_MS = 30_000;
const WS_PATH = '/ws';

/** @type {Map<number, Set<import('ws').WebSocket>>} userId -> live sockets */
const clients = new Map();

/** @type {import('ws').WebSocketServer|null} */
let wss = null;
let heartbeat = null;

/* ------------------------------------------------------------------ registry */

function addClient(userId, ws) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(ws);
}

function removeClient(userId, ws) {
  const set = clients.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) clients.delete(userId);
}

function isOnline(userId) {
  return clients.has(Number(userId));
}

function onlineUserIds() {
  return Array.from(clients.keys());
}

function connectionCount() {
  let n = 0;
  for (const set of clients.values()) n += set.size;
  return n;
}

/* ------------------------------------------------------------------- sending */

function send(ws, event, payload) {
  if (!ws || ws.readyState !== ws.OPEN) return false;
  try {
    ws.send(JSON.stringify({ event, payload, at: new Date().toISOString() }));
    return true;
  } catch (_err) {
    return false;
  }
}

/** Push an event to every live socket of one user. Returns how many got it. */
function emitToUser(userId, event, payload) {
  const set = clients.get(Number(userId));
  if (!set) return 0;
  let delivered = 0;
  for (const ws of set) if (send(ws, event, payload)) delivered += 1;
  return delivered;
}

/** Push the same event to several users (duplicates are collapsed). */
function emitToUsers(userIds, event, payload) {
  const seen = new Set();
  let delivered = 0;
  for (const id of userIds) {
    const key = Number(id);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    delivered += emitToUser(key, event, payload);
  }
  return delivered;
}

/** Push to everyone currently connected. */
function broadcast(event, payload, { exceptUserId = null } = {}) {
  let delivered = 0;
  for (const [userId, set] of clients) {
    if (exceptUserId && userId === Number(exceptUserId)) continue;
    for (const ws of set) if (send(ws, event, payload)) delivered += 1;
  }
  return delivered;
}

/* --------------------------------------------------------------------- auth */

function tokenFromRequest(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();

  // Browsers cannot set headers on a WebSocket handshake, so the token may
  // also arrive as a query parameter or as a subprotocol.
  try {
    const url = new URL(req.url, 'http://localhost');
    const q = url.searchParams.get('token') || url.searchParams.get('access_token');
    if (q) return q.trim();
  } catch (_err) {
    /* fall through */
  }

  const proto = req.headers['sec-websocket-protocol'];
  if (proto) {
    const parts = String(proto).split(',').map((p) => p.trim());
    const bearer = parts.find((p) => p.startsWith('bearer.'));
    if (bearer) return bearer.slice('bearer.'.length);
  }
  return null;
}

function userFromRequest(req) {
  const token = tokenFromRequest(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, SECRET);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub) || null;
  } catch (_err) {
    return null;
  }
}

/* ------------------------------------------------------------------ handlers */

function handleClientEvent(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch (_err) {
    return send(ws, 'error', { error: 'Malformed JSON' });
  }
  const type = msg && msg.type;

  if (type === 'ping') return send(ws, 'pong', { at: new Date().toISOString() });

  if (type === 'typing') {
    const conversationId = Number(msg.conversationId);
    if (!conversationId) return;
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
    if (!conv) return;
    if (conv.user_a !== ws.userId && conv.user_b !== ws.userId) return;
    const otherId = conv.user_a === ws.userId ? conv.user_b : conv.user_a;
    return emitToUser(otherId, 'typing', {
      conversationId,
      userId: ws.userId,
      username: ws.username,
    });
  }

  return send(ws, 'error', { error: `Unknown event type: ${type}` });
}

/* ------------------------------------------------------------------- attach */

/**
 * Attach the WebSocket hub to an existing http.Server.
 * Safe to call once per server; returns the WebSocketServer.
 */
function attachRealtime(server) {
  if (wss) return wss;

  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch (_err) {
      pathname = '/';
    }
    if (pathname !== WS_PATH && pathname !== `${WS_PATH}/`) {
      socket.destroy();
      return;
    }

    const user = userFromRequest(req);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.userId = user.id;
      ws.username = user.username;
      ws.displayName = user.display_name;
      ws.isAlive = true;
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    addClient(ws.userId, ws);

    send(ws, 'hello', {
      userId: ws.userId,
      username: ws.username,
      online: onlineUserIds(),
    });
    broadcast('presence', { userId: ws.userId, username: ws.username, online: true }, {
      exceptUserId: ws.userId,
    });

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (raw) => handleClientEvent(ws, raw));

    ws.on('close', () => {
      removeClient(ws.userId, ws);
      if (!isOnline(ws.userId)) {
        broadcast('presence', { userId: ws.userId, username: ws.username, online: false });
      }
    });

    ws.on('error', () => {
      try {
        ws.terminate();
      } catch (_err) {
        /* ignore */
      }
    });
  });

  heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch (_err) {
        /* ignore */
      }
    }
  }, HEARTBEAT_MS);
  if (heartbeat.unref) heartbeat.unref();

  return wss;
}

/** Tear the hub down (used by tests). */
function closeRealtime() {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  if (wss) {
    for (const ws of wss.clients) {
      try {
        ws.terminate();
      } catch (_err) {
        /* ignore */
      }
    }
    wss.close();
  }
  wss = null;
  clients.clear();
}

module.exports = {
  WS_PATH,
  attachRealtime,
  closeRealtime,
  emitToUser,
  emitToUsers,
  broadcast,
  isOnline,
  onlineUserIds,
  connectionCount,
};
