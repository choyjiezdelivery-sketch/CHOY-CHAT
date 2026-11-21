'use strict';

/**
 * Tests for the production hardening layer: the rate limiter, the security
 * headers and the readiness probe.
 *
 * The limiter is exercised directly rather than through the app, because the
 * app disables it under test (RATE_LIMIT_DISABLED) so the other suites can
 * register and log in freely.
 */

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { rateLimit, securityHeaders } = require('../src/security');
const app = require('../src/server');

/* ------------------------------------------------------------- rate limiter */

function fakeReq(ip) {
  return { ip, socket: { remoteAddress: ip } };
}

function fakeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

test('rate limiter allows requests up to the limit', () => {
  const limiter = rateLimit({ windowMs: 60000, max: 3 });
  for (let i = 0; i < 3; i += 1) {
    const res = fakeRes();
    let called = false;
    limiter(fakeReq('1.1.1.1'), res, () => {
      called = true;
    });
    assert.equal(called, true, `request ${i + 1} should pass`);
    assert.equal(res.statusCode, 200);
  }
});

test('rate limiter rejects the request past the limit with 429', () => {
  const limiter = rateLimit({ windowMs: 60000, max: 2, message: 'slow down' });
  limiter(fakeReq('2.2.2.2'), fakeRes(), () => {});
  limiter(fakeReq('2.2.2.2'), fakeRes(), () => {});

  const res = fakeRes();
  let called = false;
  limiter(fakeReq('2.2.2.2'), res, () => {
    called = true;
  });

  assert.equal(called, false, 'the fourth request must not reach the handler');
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error, 'slow down');
  assert.ok(res.headers['retry-after'], 'Retry-After header is set');
});

test('rate limiter counts each IP separately', () => {
  const limiter = rateLimit({ windowMs: 60000, max: 1 });
  limiter(fakeReq('3.3.3.3'), fakeRes(), () => {});

  const blocked = fakeRes();
  limiter(fakeReq('3.3.3.3'), blocked, () => {});
  assert.equal(blocked.statusCode, 429);

  const other = fakeRes();
  let called = false;
  limiter(fakeReq('4.4.4.4'), other, () => {
    called = true;
  });
  assert.equal(called, true, 'a different IP has its own budget');
});

test('rate limiter resets after the window elapses', async () => {
  const limiter = rateLimit({ windowMs: 40, max: 1 });
  limiter(fakeReq('5.5.5.5'), fakeRes(), () => {});

  const blocked = fakeRes();
  limiter(fakeReq('5.5.5.5'), blocked, () => {});
  assert.equal(blocked.statusCode, 429);

  await new Promise((r) => setTimeout(r, 60));

  const after = fakeRes();
  let called = false;
  limiter(fakeReq('5.5.5.5'), after, () => {
    called = true;
  });
  assert.equal(called, true, 'the window rolled over');
});

/* --------------------------------------------------------- security headers */

test('security headers are set on every response', () => {
  const res = fakeRes();
  securityHeaders({}, res, () => {});
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
  assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.match(res.headers['permissions-policy'], /geolocation=\(self\)/);
});

/* ------------------------------------------------- live server integration */

test('the app sends security headers and answers the readiness probe', async () => {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();

  try {
    const ready = await new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path: '/api/ready' }, (res) => {
          let body = '';
          res.on('data', (c) => {
            body += c;
          });
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        })
        .on('error', reject);
    });

    assert.equal(ready.status, 200);
    assert.equal(JSON.parse(ready.body).ready, true);
    assert.equal(ready.headers['x-content-type-options'], 'nosniff');
    assert.equal(ready.headers['x-powered-by'], undefined, 'x-powered-by is disabled');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
