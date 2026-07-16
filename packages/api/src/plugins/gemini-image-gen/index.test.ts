// Stability: 1 - Experimental (node:test)
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ModelStrategy, modelId, configSchema } from './index.js';
import { ApiError } from '../../core/ApiError.js';

function fakeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

const VALID_PNG_BASE64 = Buffer.from('fake-png-bytes').toString('base64');

describe('gemini-image-gen plugin — request-side multimodal input validation', () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env['GEMINI_API_KEY'];

  beforeEach(() => {
    process.env['GEMINI_API_KEY'] = 'test-key';
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env['GEMINI_API_KEY'];
    else process.env['GEMINI_API_KEY'] = realKey;
  });

  it('exposes the plugin contract the loader requires', () => {
    assert.equal(modelId, 'gemini-image-gen');
    assert.equal(typeof configSchema, 'object');
    assert.equal(typeof ModelStrategy, 'function');
  });

  it('rejects an inputImages entry with a disallowed MIME type, without calling Gemini', async () => {
    const fetchMock = mock.fn(async () => fakeResponse(200, { candidates: [] }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const strategy = new ModelStrategy();
    await assert.rejects(
      () =>
        strategy.process(
          {
            prompt: 'edit this',
            inputImages: [{ data: VALID_PNG_BASE64, mimeType: 'application/pdf' }],
          },
          {},
        ),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /mimeType must be one of/);
        return true;
      },
    );
    assert.equal(
      fetchMock.mock.callCount(),
      0,
      'invalid input must fail before hitting the network',
    );
  });

  it('rejects an inputImages entry whose base64 data exceeds the 10MB decoded limit', async () => {
    const fetchMock = mock.fn(async () => fakeResponse(200, { candidates: [] }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // ~10.5MB of base64 chars, well past the ~10MB decoded bound.
    const oversized = 'A'.repeat(Math.ceil((10.5 * 1024 * 1024 * 4) / 3));

    const strategy = new ModelStrategy();
    await assert.rejects(
      () =>
        strategy.process(
          { prompt: 'edit this', inputImages: [{ data: oversized, mimeType: 'image/png' }] },
          {},
        ),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /exceeds the 10MB/);
        return true;
      },
    );
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('rejects data that is not valid base64 (e.g. a data: URI prefix or raw text)', async () => {
    const strategy = new ModelStrategy();
    await assert.rejects(
      () =>
        strategy.process(
          {
            prompt: 'edit this',
            inputImages: [{ data: 'data:image/png;base64,AAA', mimeType: 'image/png' }],
          },
          {},
        ),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.match(err.message, /valid base64/);
        return true;
      },
    );
  });

  it('rejects more than 5 input images', async () => {
    const strategy = new ModelStrategy();
    const inputImages = Array.from({ length: 6 }, () => ({
      data: VALID_PNG_BASE64,
      mimeType: 'image/png' as const,
    }));

    await assert.rejects(
      () => strategy.process({ prompt: 'compose these', inputImages }, {}),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.match(err.message, /cannot contain more than 5 images/);
        return true;
      },
    );
  });

  it('accepts well-formed inputImages and proceeds to call Gemini', async () => {
    const fetchMock = mock.fn(async () =>
      fakeResponse(200, {
        candidates: [
          { content: { parts: [{ inlineData: { data: 'b64', mimeType: 'image/png' } }] } },
        ],
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const strategy = new ModelStrategy();
    const output = await strategy.process(
      { prompt: 'edit this', inputImages: [{ data: VALID_PNG_BASE64, mimeType: 'image/png' }] },
      {},
    );

    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(output.result.images.length, 1);
  });

  it('is a no-op when inputImages is omitted (text-to-image path unaffected)', async () => {
    const fetchMock = mock.fn(async () => fakeResponse(200, { candidates: [] }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const strategy = new ModelStrategy();
    const output = await strategy.process({ prompt: 'a cat riding a bike' }, {});
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.deepEqual(output.result.images, []);
  });
});
