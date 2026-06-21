// Stability: 1 - Experimental (node:test)
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ResilientTransport, TransportHttpError } from './resilient-transport.js';

/** Build a fake Response with a given status, body and headers. */
function fakeResponse(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

describe('ResilientTransport', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('returns the response on the first successful attempt (no retry)', async () => {
    const fetchMock = mock.fn(async () => fakeResponse(200, JSON.stringify({ ok: true })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const t = new ResilientTransport({ maxRetries: 2, baseDelayMs: 1 });
    const data = await t.fetchJson<{ ok: boolean }>('https://x.test/api');

    assert.equal(data.ok, true);
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  it('does NOT retry a non-retryable 4xx (400) and throws immediately', async () => {
    const fetchMock = mock.fn(async () => fakeResponse(400, 'bad input'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const t = new ResilientTransport({ maxRetries: 3, baseDelayMs: 1 });

    await assert.rejects(
      () => t.fetchWithRetry('https://x.test/api'),
      (err: unknown) => err instanceof TransportHttpError && err.status === 400 && !err.isRetryable,
    );
    assert.equal(fetchMock.mock.callCount(), 1, 'a 400 must not be retried');
  });

  it('retries a 503 and eventually succeeds', async () => {
    let calls = 0;
    const fetchMock = mock.fn(async () => {
      calls++;
      if (calls < 3) return fakeResponse(503, 'unavailable');
      return fakeResponse(200, JSON.stringify({ recovered: true }));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const t = new ResilientTransport({ maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5 });
    const data = await t.fetchJson<{ recovered: boolean }>('https://x.test/api');

    assert.equal(data.recovered, true);
    assert.equal(fetchMock.mock.callCount(), 3);
  });

  it('honors a 429 Retry-After header (seconds) clamped to maxDelayMs', async () => {
    let calls = 0;
    const fetchMock = mock.fn(async () => {
      calls++;
      if (calls === 1) return fakeResponse(429, 'slow down', { 'retry-after': '120' });
      return fakeResponse(200, JSON.stringify({ ok: true }));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // maxDelayMs caps the 120s header to 5ms so the test is fast and proves clamping.
    const t = new ResilientTransport({ maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5 });
    const start = Date.now();
    const data = await t.fetchJson<{ ok: boolean }>('https://x.test/api');
    const elapsed = Date.now() - start;

    assert.equal(data.ok, true);
    assert.equal(fetchMock.mock.callCount(), 2);
    assert.ok(elapsed < 1000, 'a 120s Retry-After must be clamped, not waited out');
  });

  it('gives up after exhausting retries and throws the last error', async () => {
    const fetchMock = mock.fn(async () => fakeResponse(500, 'boom'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const t = new ResilientTransport({ maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2 });

    await assert.rejects(
      () => t.fetchWithRetry('https://x.test/api'),
      (err: unknown) => err instanceof TransportHttpError && err.status === 500,
    );
    // first try + 2 retries = 3 calls
    assert.equal(fetchMock.mock.callCount(), 3);
  });

  it('never retries when the caller aborts', async () => {
    const controller = new AbortController();
    const fetchMock = mock.fn(async () => {
      controller.abort();
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const t = new ResilientTransport({ maxRetries: 3, baseDelayMs: 1 });

    await assert.rejects(() =>
      t.fetchWithRetry('https://x.test/api', { signal: controller.signal }),
    );
    assert.equal(fetchMock.mock.callCount(), 1, 'an aborted request is not retried');
  });

  it('throws a non-retryable error when the body is not valid JSON', async () => {
    const fetchMock = mock.fn(async () => fakeResponse(200, 'not json <html>'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const t = new ResilientTransport({ maxRetries: 2, baseDelayMs: 1 });

    await assert.rejects(
      () => t.fetchJson('https://x.test/api'),
      (err: unknown) => err instanceof TransportHttpError && !err.isRetryable,
    );
    assert.equal(fetchMock.mock.callCount(), 1, 'a valid 200 with bad JSON is not retried');
  });
});
