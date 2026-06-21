// Stability: 1 - Experimental (node:test)
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response, NextFunction } from 'express';
import { rateLimiter } from './rateLimiter.js';
import { InMemoryRateLimitStore } from '../../infrastructure/rate-limit/InMemoryRateLimitStore.js';
import type { RateLimitStore } from '../../core/interfaces/RateLimitStore.js';

function makeCtx(apiKeyId = 'k1') {
  const statusCalls: number[] = [];
  const headers: Record<string, string> = {};
  const req = {
    user: { apiKeyId, authenticated: true },
    ip: '127.0.0.1',
    path: '/api/test',
  } as unknown as Request;
  const res = {
    setHeader(k: string, v: string) {
      headers[k] = v;
    },
    status(code: number) {
      statusCalls.push(code);
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;
  const next = mock.fn<NextFunction>();
  return { req, res, next, statusCalls, headers };
}

describe('rateLimiter (store-backed)', () => {
  it('allows requests under the limit and increments per identifier', async () => {
    const mw = rateLimiter({ windowMs: 1000, max: 3, store: new InMemoryRateLimitStore() });
    const { req, res, next, statusCalls } = makeCtx();

    await mw(req, res, next);
    await mw(req, res, next);
    await mw(req, res, next);

    assert.equal(next.mock.callCount(), 3, 'three calls under the limit pass through');
    assert.deepEqual(statusCalls, []);
  });

  it('returns 429 once the limit is exceeded, with a Retry-After header', async () => {
    const mw = rateLimiter({ windowMs: 10_000, max: 2, store: new InMemoryRateLimitStore() });
    const { req, res, next, statusCalls, headers } = makeCtx();

    await mw(req, res, next); // 1
    await mw(req, res, next); // 2
    await mw(req, res, next); // 3 -> over

    assert.equal(next.mock.callCount(), 2, 'only the first two pass');
    assert.deepEqual(statusCalls, [429]);
    assert.ok(headers['Retry-After'], 'sets a Retry-After header on 429');
  });

  it('keys by API key identity (separate buckets per tenant)', async () => {
    const store = new InMemoryRateLimitStore();
    const mw = rateLimiter({ windowMs: 10_000, max: 1, store });

    const a = makeCtx('tenant-a');
    const b = makeCtx('tenant-b');

    await mw(a.req, a.res, a.next); // a #1 ok
    await mw(a.req, a.res, a.next); // a #2 over
    await mw(b.req, b.res, b.next); // b #1 ok (own bucket)

    assert.deepEqual(a.statusCalls, [429], 'tenant A is limited on its 2nd request');
    assert.equal(b.next.mock.callCount(), 1, 'tenant B is unaffected');
    assert.deepEqual(b.statusCalls, []);
  });

  it('fails CLOSED with 503 when the store throws (never silently unlimited)', async () => {
    const brokenStore: RateLimitStore = {
      hit: async () => {
        throw new Error('db down');
      },
    };
    const mw = rateLimiter({ windowMs: 1000, max: 5, store: brokenStore });
    const { req, res, next, statusCalls } = makeCtx();

    await mw(req, res, next);

    assert.equal(next.mock.callCount(), 0, 'must NOT pass through on store failure');
    assert.deepEqual(statusCalls, [503]);
  });
});
