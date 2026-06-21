// Stability: 1 - Experimental (node:test)
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response, NextFunction } from 'express';
import { apiKeyAuth, optionalApiKeyAuth } from './apiKeyAuth.js';

/**
 * Builds a minimal Express-like req/res/next triple. `apiKeyAuth` only reads
 * headers and writes `req.user`, so a thin stub is enough.
 */
function makeCtx(apiKey?: string) {
  const req = {
    headers: apiKey ? { 'x-api-key': apiKey } : {},
    method: 'GET',
    path: '/test',
    ip: '127.0.0.1',
    get: () => undefined,
  } as unknown as Request;
  const res = {} as unknown as Response;
  const next = mock.fn<NextFunction>();
  return { req, res, next };
}

const PREMIUM_KEY = 'premium-test-key';
const FREE_KEY = 'free-test-key';

describe('apiKeyAuth tier population', () => {
  beforeEach(() => {
    // Register one premium-permissioned key and one free key for these tests.
    process.env['API_KEY_PREMIUM_TEST'] = `${PREMIUM_KEY}:read,premium`;
    process.env['API_KEY_FREE_TEST'] = `${FREE_KEY}:read`;
  });

  afterEach(() => {
    delete process.env['API_KEY_PREMIUM_TEST'];
    delete process.env['API_KEY_FREE_TEST'];
  });

  it('populates req.user.tier = premium for a key carrying the premium permission', () => {
    const { req, res, next } = makeCtx(PREMIUM_KEY);
    apiKeyAuth(req, res, next);
    assert.equal(next.mock.callCount(), 1);
    assert.equal(next.mock.calls[0]!.arguments[0], undefined, 'must authenticate without error');
    assert.equal(req.user?.tier, 'premium');
  });

  it('populates req.user.tier = free for a key without the premium permission', () => {
    const { req, res, next } = makeCtx(FREE_KEY);
    apiKeyAuth(req, res, next);
    assert.equal(next.mock.callCount(), 1);
    assert.equal(req.user?.tier, 'free');
  });

  it('optionalApiKeyAuth leaves tier unset for an unauthenticated request', () => {
    const { req, res, next } = makeCtx(undefined);
    optionalApiKeyAuth(req, res, next);
    assert.equal(next.mock.callCount(), 1);
    assert.equal(req.user?.authenticated, false);
    assert.equal(req.user?.tier, undefined, 'no tier when not authenticated');
  });
});
