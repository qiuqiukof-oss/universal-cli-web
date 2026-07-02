// ============================================================
// Rate-limiter tests — pure logic, no network, no deps
// ============================================================
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimiter } = require('../rate-limiter');

/**
 * Build a fake Express req/res/next trio.
 */
function mockReqRes(ip) {
  const req = { ip, connection: { remoteAddress: ip } };
  let statusCode, body;
  const res = {
    status: (code) => {
      statusCode = code;
      return { json: (b) => { body = b; } };
    },
    _getStatus: () => statusCode,
    _getBody: () => body,
  };
  let called = false;
  const next = () => { called = true; };
  const _wasCalled = () => called;
  return { req, res, next, _wasCalled };
}

describe('createRateLimiter', () => {

  it('should allow first request', () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 5 });
    const { req, res, next, _wasCalled } = mockReqRes('192.168.1.1');
    limiter(req, res, next);
    assert.equal(_wasCalled(), true, 'next() should be called for first request');
  });

  it('should block when exceeding max', () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 3 });
    const { req, res, next: n1 } = mockReqRes('10.0.0.1');
    limiter(req, res, n1);

    // second
    const { res: r2, next: n2 } = mockReqRes('10.0.0.1');
    r2.status = res.status; // reuse status stub
    limiter({ ip: '10.0.0.1', connection: { remoteAddress: '10.0.0.1' } }, r2, n2);

    // third — still within max, allowed
    const { res: r3, next: n3 } = mockReqRes('10.0.0.1');
    r3.status = res.status;
    limiter({ ip: '10.0.0.1', connection: { remoteAddress: '10.0.0.1' } }, r3, n3);

    // fourth — exceed max, should get 429
    const { res: r4, next: n4 } = mockReqRes('10.0.0.1');
    r4.status = (code) => {
      assert.equal(code, 429);
      return { json: (b) => {
        assert.ok(b.error);
      }};
    };
    limiter({ ip: '10.0.0.1', connection: { remoteAddress: '10.0.0.1' } }, r4, n4);
  });

  it('should reset after window expires', async () => {
    const limiter = createRateLimiter({ windowMs: 50, max: 1 });
    const req = { ip: '10.0.0.2', connection: { remoteAddress: '10.0.0.2' } };

    // first — allowed
    const { res: r1, next: n1 } = mockReqRes('10.0.0.2');
    limiter(req, r1, n1);

    // second — blocked
    const { res: r2 } = mockReqRes('10.0.0.2');
    let blocked = false;
    r2.status = (code) => {
      blocked = code === 429;
      return { json: () => {} };
    };
    limiter(req, r2, () => {});
    assert.equal(blocked, true, 'second request should be blocked');

    // wait for window to expire
    await new Promise(r => setTimeout(r, 60));

    // third — allowed again
    const { res: r3, next: n3 } = mockReqRes('10.0.0.2');
    let passed = false;
    r3.status = () => ({ json: () => {} });
    limiter(req, r3, () => { passed = true; });
    assert.equal(passed, true, 'request after window expiry should be allowed');
  });

  it('should track different IPs independently', () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 2 });
    const ipA = '10.0.0.10';
    const ipB = '10.0.0.20';

    // A: 2 requests, B: 1 request
    for (let i = 0; i < 2; i++) {
      const { res, next } = mockReqRes(ipA);
      limiter({ ip: ipA, connection: { remoteAddress: ipA } }, res, next);
    }
    const { res: rA3 } = mockReqRes(ipA);
    let aBlocked = false;
    rA3.status = (c) => { if (c === 429) aBlocked = true; return { json: () => {} }; };
    limiter({ ip: ipA, connection: { remoteAddress: ipA } }, rA3, () => {});
    assert.equal(aBlocked, true, 'A should be blocked after 2 requests');

    // B should be fine
    const { res: rB, next: nB } = mockReqRes(ipB);
    let bPassed = false;
    rB.status = () => ({ json: () => {} });
    limiter({ ip: ipB, connection: { remoteAddress: ipB } }, rB, () => { bPassed = true; });
    assert.equal(bPassed, true, 'B should be unaffected by A\'s count');
  });

});
