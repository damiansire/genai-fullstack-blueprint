// Stability: 1 - Experimental (node:test)
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response, NextFunction } from 'express';
import { rbacModelMiddleware } from './rbac.js';

/**
 * Builds a minimal Express-like req/res/next triple for exercising the
 * middleware. `res.status().json()` is recorded so assertions can inspect
 * the HTTP code and body the middleware would have sent.
 */
function makeCtx(params: Record<string, string>, user?: { tier?: string; apiKeyId?: string }) {
  const sent: { status?: number; body?: any } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: any) {
      sent.body = body;
      return this;
    },
  } as unknown as Response;

  const req = { params, user } as unknown as Request;
  const next = mock.fn<NextFunction>();
  return { req, res, next, sent };
}

describe('rbacModelMiddleware', () => {
  it('calls next() when no modelId param is present', () => {
    const { req, res, next, sent } = makeCtx({});
    rbacModelMiddleware(req, res, next);
    assert.equal(next.mock.callCount(), 1);
    assert.equal(sent.status, undefined);
  });

  it('treats unknown models as free tier and lets a free user through', () => {
    const { req, res, next, sent } = makeCtx({ modelId: 'some-unlisted-model' }, { tier: 'free' });
    rbacModelMiddleware(req, res, next);
    assert.equal(next.mock.callCount(), 1);
    assert.equal(sent.status, undefined);
  });

  it('allows a free user to access a free model', () => {
    const { req, res, next, sent } = makeCtx({ modelId: 'gemini-1.5-flash' }, { tier: 'free' });
    rbacModelMiddleware(req, res, next);
    assert.equal(next.mock.callCount(), 1);
    assert.equal(sent.status, undefined);
  });

  it('blocks a free user from a premium model with 403 and does not call next()', () => {
    const { req, res, next, sent } = makeCtx(
      { modelId: 'gemini-1.5-pro' },
      { tier: 'free', apiKeyId: 'key-123' },
    );
    rbacModelMiddleware(req, res, next);
    assert.equal(next.mock.callCount(), 0, 'next must not run when access is denied');
    assert.equal(sent.status, 403);
    assert.equal(sent.body.success, false);
    assert.equal(sent.body.error, 'Forbidden');
    assert.match(sent.body.message, /requires 'premium' tier/);
  });

  it('allows a premium user to access a premium model', () => {
    const { req, res, next, sent } = makeCtx({ modelId: 'gemini-1.5-pro' }, { tier: 'premium' });
    rbacModelMiddleware(req, res, next);
    assert.equal(next.mock.callCount(), 1);
    assert.equal(sent.status, undefined);
  });

  it('allows a premium user to access a free model (higher tier covers lower)', () => {
    const { req, res, next, sent } = makeCtx({ modelId: 'gemini-1.5-flash' }, { tier: 'premium' });
    rbacModelMiddleware(req, res, next);
    assert.equal(next.mock.callCount(), 1);
    assert.equal(sent.status, undefined);
  });

  it('defaults a user with no tier to free and blocks premium access', () => {
    const { req, res, next, sent } = makeCtx({ modelId: 'gemini-image-gen' }, {});
    rbacModelMiddleware(req, res, next);
    assert.equal(next.mock.callCount(), 0);
    assert.equal(sent.status, 403);
  });

  it('treats an unrecognized tier as level 0 (free) and blocks premium access', () => {
    const { req, res, next, sent } = makeCtx({ modelId: 'gemini-1.5-pro' }, { tier: 'enterprise' });
    rbacModelMiddleware(req, res, next);
    assert.equal(next.mock.callCount(), 0);
    assert.equal(sent.status, 403);
  });
});
