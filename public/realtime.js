/* CHOY-CHAT — realtime client (WebSocket)
 *
 * A tiny dependency-free wrapper around the browser WebSocket API:
 *   - connects to /ws with the JWT as a query parameter
 *   - auto-reconnects with exponential backoff (1s -> 15s)
 *   - re-emits every server event to registered listeners
 *
 * Usage:
 *   ChoyRealtime.connect(token);
 *   ChoyRealtime.on('message:new', (payload) => { ... });
 *   ChoyRealtime.typing(conversationId);
 */
'use strict';

(function () {
  const listeners = Object.create(null);

  let socket = null;
  let token = null;
  let attempts = 0;
  let reconnectTimer = null;
  let manualClose = false;
  let status = 'offline';

  function on(event, fn) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
    return function unsubscribe() {
      off(event, fn);
    };
  }

  function off(event, fn) {
    const arr = listeners[event];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }

  function fire(event, payload) {
    const arr = listeners[event];
    if (arr) {
      for (const fn of arr.slice()) {
        try {
          fn(payload);
        } catch (err) {
          console.error('[realtime] handler failed for', event, err);
        }
      }
    }
    const any = listeners['*'];
    if (any) {
      for (const fn of any.slice()) {
        try {
          fn({ event, payload });
        } catch (_err) {
          /* ignore */
        }
      }
    }
  }

  function setStatus(next) {
    if (status === next) return;
    status = next;
    fire('status', { status: next });
  }

  function socketUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws?token=${encodeURIComponent(token)}`;
  }

  function scheduleReconnect() {
    if (manualClose || !token) return;
    attempts += 1;
    const delay = Math.min(1000 * Math.pow(1.6, attempts - 1), 15000);
    setStatus('reconnecting');
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => connect(), delay);
  }

  function connect(nextToken) {
    if (nextToken) token = nextToken;
    if (!token) return;
    manualClose = false;

    if (
      socket &&
      (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    clearTimeout(reconnectTimer);
    setStatus(attempts > 0 ? 'reconnecting' : 'connecting');

    try {
      socket = new WebSocket(socketUrl());
    } catch (_err) {
      socket = null;
      scheduleReconnect();
      return;
    }

    socket.onopen = function () {
      attempts = 0;
      setStatus('online');
      fire('open', {});
    };

    socket.onmessage = function (ev) {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (_err) {
        return;
      }
      if (msg && msg.event) fire(msg.event, msg.payload || {});
    };

    socket.onclose = function () {
      socket = null;
      setStatus('offline');
      if (!manualClose) scheduleReconnect();
    };

    socket.onerror = function () {
      try {
        if (socket) socket.close();
      } catch (_err) {
        /* ignore */
      }
    };
  }

  function disconnect() {
    manualClose = true;
    clearTimeout(reconnectTimer);
    attempts = 0;
    if (socket) {
      try {
        socket.close();
      } catch (_err) {
        /* ignore */
      }
    }
    socket = null;
    setStatus('offline');
  }

  function send(type, data) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify(Object.assign({ type: type }, data || {})));
      return true;
    } catch (_err) {
      return false;
    }
  }

  function typing(conversationId) {
    return send('typing', { conversationId: conversationId });
  }

  window.ChoyRealtime = {
    connect: connect,
    disconnect: disconnect,
    on: on,
    off: off,
    send: send,
    typing: typing,
    getStatus: function () {
      return status;
    },
    isOnline: function () {
      return status === 'online';
    },
  };
})();
