/* ==========================================================================
   CHOY-CHAT — realtime client
   A thin WebSocket wrapper: auto-reconnect with backoff, an event bus, and a
   `status` event ('live' | 'connecting' | 'offline') the UI can render.
   ========================================================================== */
'use strict';

(function () {
  const listeners = new Map();
  let socket = null;
  let token = null;
  let attempts = 0;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let manualClose = false;

  const MAX_BACKOFF = 15000;

  function emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[realtime] listener for "${event}" threw:`, err);
      }
    }
  }

  function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event).delete(fn);
  }

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws?token=${encodeURIComponent(token || '')}`;
  }

  function connect(nextToken) {
    if (nextToken) token = nextToken;
    if (!token) return;
    manualClose = false;

    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    emit('status', attempts === 0 ? 'connecting' : 'connecting');

    try {
      socket = new WebSocket(wsUrl());
    } catch (err) {
      emit('status', 'offline');
      scheduleReconnect();
      return;
    }

    socket.addEventListener('open', () => {
      attempts = 0;
      emit('status', 'live');
      startHeartbeat();
    });

    socket.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (_err) {
        return;
      }
      if (!msg || !msg.event) return;
      emit(msg.event, msg.payload || {});
    });

    socket.addEventListener('close', () => {
      stopHeartbeat();
      emit('status', 'offline');
      if (!manualClose) scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      // The close handler does the reconnecting; just surface the state.
      emit('status', 'offline');
    });
  }

  function scheduleReconnect() {
    if (manualClose || reconnectTimer) return;
    attempts += 1;
    const delay = Math.min(1000 * Math.pow(2, attempts - 1), MAX_BACKOFF);
    emit('status', 'connecting');
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      send({ type: 'ping' });
    }, 25000);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function send(obj) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify(obj));
      return true;
    } catch (_err) {
      return false;
    }
  }

  function disconnect() {
    manualClose = true;
    stopHeartbeat();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (socket) {
      try {
        socket.close();
      } catch (_err) {
        /* ignore */
      }
      socket = null;
    }
    attempts = 0;
    emit('status', 'offline');
  }

  function isLive() {
    return !!socket && socket.readyState === WebSocket.OPEN;
  }

  window.ChoyRealtime = { connect, disconnect, on, send, isLive };
})();
