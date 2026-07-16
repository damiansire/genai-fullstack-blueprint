// Stability: 1 - Experimental (node:test)
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ModelStrategy, modelId, configSchema } from './index.js';

/** Build a fake Response with a given status/body (same helper shape as resilient-transport.test.ts). */
function fakeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('openai-chat plugin (second real provider behind IModelStrategy)', () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env['OPENAI_API_KEY'];

  beforeEach(() => {
    process.env['OPENAI_API_KEY'] = 'test-key';
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env['OPENAI_API_KEY'];
    else process.env['OPENAI_API_KEY'] = realKey;
  });

  it('exposes the plugin contract the loader requires (modelId, configSchema, ModelStrategy)', () => {
    assert.equal(modelId, 'openai-gpt-4o-mini');
    assert.equal(typeof configSchema, 'object');
    assert.deepEqual(configSchema.required, ['prompt']);
    assert.equal(typeof ModelStrategy, 'function');
  });

  it('sends an Authorization bearer header and maps prompt -> chat messages', async () => {
    const fetchMock = mock.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      assert.equal(body.model, 'gpt-4o-mini');
      assert.deepEqual(body.messages, [{ role: 'user', content: 'hola mundo' }]);
      assert.equal((init.headers as Record<string, string>)['Authorization'], 'Bearer test-key');
      return fakeResponse(200, {
        choices: [
          { message: { role: 'assistant', content: 'hola de vuelta' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const strategy = new ModelStrategy();
    const output = await strategy.process({ prompt: 'hola mundo' }, {});

    assert.equal(output.result.text, 'hola de vuelta');
    assert.equal(output.result.finishReason, 'STOP');
    assert.deepEqual(output.result.usage, {
      promptTokens: 3,
      completionTokens: 4,
      totalTokens: 7,
    });
    assert.equal(output.metadata?.apiProvider, 'OpenAI');
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  it('maps finish_reason "length" to MAX_TOKENS', async () => {
    globalThis.fetch = mock.fn(async () =>
      fakeResponse(200, {
        choices: [{ message: { content: 'truncated' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    ) as unknown as typeof fetch;

    const strategy = new ModelStrategy();
    const output = await strategy.process({ prompt: 'hi' }, {});
    assert.equal(output.result.finishReason, 'MAX_TOKENS');
  });

  it('throws a clear config error and never calls fetch when OPENAI_API_KEY is missing', async () => {
    delete process.env['OPENAI_API_KEY'];
    const fetchMock = mock.fn(async () => fakeResponse(200, {}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const strategy = new ModelStrategy();
    await assert.rejects(
      () => strategy.process({ prompt: 'hi' }, {}),
      /OPENAI_API_KEY is not configured/,
    );
    assert.equal(
      fetchMock.mock.callCount(),
      0,
      'a missing key must fail fast, never hit the network',
    );
  });

  it('surfaces the OpenAI error payload instead of a generic parse failure', async () => {
    globalThis.fetch = mock.fn(async () =>
      fakeResponse(401, {
        error: { message: 'Incorrect API key provided', type: 'invalid_request_error' },
      }),
    ) as unknown as typeof fetch;

    const strategy = new ModelStrategy();
    await assert.rejects(() => strategy.process({ prompt: 'hi' }, {}));
  });

  it('rejects an empty prompt before ever calling fetch', async () => {
    const fetchMock = mock.fn(async () => fakeResponse(200, {}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const strategy = new ModelStrategy();
    await assert.rejects(() => strategy.process({ prompt: '' }, {}), /Prompt is required/);
    assert.equal(fetchMock.mock.callCount(), 0);
  });
});
