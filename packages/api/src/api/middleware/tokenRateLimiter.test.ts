// Stability: 1 - Experimental (node:test)
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response, NextFunction } from 'express';
import { tokenRateLimiter } from './tokenRateLimiter.js';
import type { TokenStore } from '../../core/interfaces/TokenStore.js';

function makeCtx() {
  const statusCalls: number[] = [];
  const jsonBodies: unknown[] = [];
  const req = {
    user: { apiKeyId: 'k1', authenticated: true },
    ip: '127.0.0.1',
    path: '/api/test',
  } as unknown as Request;
  const res = {
    locals: {} as Record<string, unknown>,
    status(code: number) {
      statusCalls.push(code);
      return this;
    },
    json(body: unknown) {
      jsonBodies.push(body);
      return this;
    },
  } as unknown as Response & { locals: Record<string, unknown> };
  const next = mock.fn<NextFunction>();
  return { req, res, next, statusCalls, jsonBodies };
}

describe('tokenRateLimiter fail-closed behaviour', () => {
  it('denies the request with 503 when the store throws (does NOT fail open)', async () => {
    const store: TokenStore = {
      consume: async () => {},
      getConsumedTokens: async () => {
        throw new Error('db hiccup');
      },
    };
    const { req, res, next, statusCalls } = makeCtx();

    await tokenRateLimiter(store, { windowMs: 1000, maxTokens: 100 })(req, res, next);

    assert.equal(next.mock.callCount(), 0, 'must NOT call next() on store failure (fail closed)');
    assert.deepEqual(statusCalls, [503], 'denies with 503 Service Unavailable');
  });

  it('allows the request when under budget', async () => {
    const store: TokenStore = {
      consume: async () => {},
      getConsumedTokens: async () => 10,
    };
    const { req, res, next, statusCalls } = makeCtx();

    await tokenRateLimiter(store, { windowMs: 1000, maxTokens: 100 })(req, res, next);

    assert.equal(next.mock.callCount(), 1, 'passes through when under the limit');
    assert.deepEqual(statusCalls, [], 'no error status when allowed');
  });

  it('returns 429 when the budget is exhausted', async () => {
    const store: TokenStore = {
      consume: async () => {},
      getConsumedTokens: async () => 100,
    };
    const { req, res, next, statusCalls } = makeCtx();

    await tokenRateLimiter(store, { windowMs: 1000, maxTokens: 100 })(req, res, next);

    assert.equal(next.mock.callCount(), 0);
    assert.deepEqual(statusCalls, [429], 'rejects over-budget callers with 429');
  });
});
