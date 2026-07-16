// Stability: 1 - Experimental (node:test)
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  stableStringify,
  invokeBodySchema,
  applySlidingWindow,
  AGENTIC_CONTEXT_WINDOW,
  InvokeModelUseCase,
  getFallbackChain,
} from './invoke-model.usecase.js';
import { ModelFactory } from '../../infrastructure/ai/factory.js';
import { ApiError } from '../../core/ApiError.js';

describe('InvokeModelUseCase / getFallbackChain (multi-provider degrade path)', () => {
  const realEnv = process.env['FALLBACK_MODEL_CHAIN'];

  afterEach(() => {
    if (realEnv === undefined) delete process.env['FALLBACK_MODEL_CHAIN'];
    else process.env['FALLBACK_MODEL_CHAIN'] = realEnv;
  });

  it('defaults to the second real provider (OpenAI) before the local SLM', () => {
    delete process.env['FALLBACK_MODEL_CHAIN'];
    assert.deepEqual(getFallbackChain(), ['openai-gpt-4o-mini', 'llama-3.1-8b']);
  });

  it('honors FALLBACK_MODEL_CHAIN as an ordered, trimmed, comma-separated list', () => {
    process.env['FALLBACK_MODEL_CHAIN'] = ' model-a , model-b ,model-c';
    assert.deepEqual(getFallbackChain(), ['model-a', 'model-b', 'model-c']);
  });

  it('drops empty entries from a malformed env value', () => {
    process.env['FALLBACK_MODEL_CHAIN'] = 'model-a,,  ,model-b';
    assert.deepEqual(getFallbackChain(), ['model-a', 'model-b']);
  });
});

describe('InvokeModelUseCase / processWithFallback (falls into the second real provider)', () => {
  const realEnv = process.env['FALLBACK_MODEL_CHAIN'];

  afterEach(() => {
    if (realEnv === undefined) delete process.env['FALLBACK_MODEL_CHAIN'];
    else process.env['FALLBACK_MODEL_CHAIN'] = realEnv;
  });

  it('routes to the fallback provider once the primary breaker is OPEN, and never once it is registered as unavailable', async () => {
    process.env['FALLBACK_MODEL_CHAIN'] = 'secondary-provider';

    const factory = new ModelFactory();
    let primaryCalls = 0;
    factory.register('primary-provider', () => ({
      process: async () => {
        primaryCalls++;
        throw new Error('primary is down');
      },
    }));

    let secondaryCalls = 0;
    let lastSecondaryReq: any;
    factory.register('secondary-provider', () => ({
      process: async (req: any) => {
        secondaryCalls++;
        lastSecondaryReq = req;
        return { text: 'from secondary provider' };
      },
    }));

    const useCase = new InvokeModelUseCase(factory) as any;

    // failureThreshold is 3: the first 2 failures keep the breaker CLOSED, so
    // they still reject straight from the (down) primary.
    for (let i = 0; i < 2; i++) {
      await assert.rejects(() =>
        useCase.processWithFallback(
          factory.create('primary-provider'),
          'primary-provider',
          { messages: [] },
          {},
        ),
      );
    }
    assert.equal(primaryCalls, 2);

    // The 3rd failure trips the breaker to OPEN *within this same call*, so
    // processWithFallback's catch immediately routes to the fallback provider
    // instead of propagating the error — this call resolves, it does not reject.
    const result = await useCase.processWithFallback(
      factory.create('primary-provider'),
      'primary-provider',
      { messages: [] },
      {},
    );

    assert.equal(
      primaryCalls,
      3,
      'the 3rd call still hits the (down) primary once, tripping the breaker',
    );
    assert.equal(secondaryCalls, 1);
    assert.equal(result.text, 'from secondary provider');
    assert.ok(
      lastSecondaryReq.messages.some(
        (m: any) => m.role === 'system' && /secondary-provider/.test(m.content),
      ),
      'the fallback request is tagged with which provider handled it',
    );

    // Breaker is now OPEN: a subsequent call must fast-fail the primary
    // (no network/strategy call) and go straight to the fallback again.
    await useCase.processWithFallback(
      factory.create('primary-provider'),
      'primary-provider',
      { messages: [] },
      {},
    );
    assert.equal(
      primaryCalls,
      3,
      'an OPEN breaker must fast-fail, never invoking the primary strategy again',
    );
    assert.equal(secondaryCalls, 2);
  });
});

describe('InvokeModelUseCase / stableStringify (cache key canonicalization)', () => {
  it('produces the SAME string regardless of object key order', () => {
    const a = stableStringify({ modelId: 'm', body: { temperature: 0.2, prompt: 'hi' } });
    const b = stableStringify({ body: { prompt: 'hi', temperature: 0.2 }, modelId: 'm' });
    assert.equal(a, b, 'key ordering must not change the cache key');
  });

  it('canonicalizes nested objects recursively', () => {
    const a = stableStringify({ outer: { z: 1, a: { y: 2, x: 3 } } });
    const b = stableStringify({ outer: { a: { x: 3, y: 2 }, z: 1 } });
    assert.equal(a, b);
  });

  it('PRESERVES array order (arrays are sequence-sensitive, e.g. message history)', () => {
    const a = stableStringify({ messages: ['first', 'second'] });
    const b = stableStringify({ messages: ['second', 'first'] });
    assert.notEqual(a, b, 'reordering messages must yield a different cache key');
  });

  it('distinguishes different values', () => {
    assert.notEqual(
      stableStringify({ body: { prompt: 'a' } }),
      stableStringify({ body: { prompt: 'b' } }),
    );
  });
});

describe('InvokeModelUseCase / invokeBodySchema (boundary validation)', () => {
  it('accepts a body with no messages (passthrough of arbitrary model params)', () => {
    const parsed = invokeBodySchema.safeParse({ prompt: 'hi', temperature: 0.7 });
    assert.equal(parsed.success, true);
    if (parsed.success) {
      // arbitrary model params survive validation untouched
      assert.equal((parsed.data as Record<string, unknown>)['prompt'], 'hi');
      assert.equal((parsed.data as Record<string, unknown>)['temperature'], 0.7);
    }
  });

  it('accepts a well-formed messages array and a boolean stream flag', () => {
    const parsed = invokeBodySchema.safeParse({
      stream: true,
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hello' },
      ],
    });
    assert.equal(parsed.success, true);
  });

  it('rejects messages that is not an array', () => {
    const parsed = invokeBodySchema.safeParse({ messages: 'not-an-array' });
    assert.equal(parsed.success, false);
  });

  it('rejects message items without a role', () => {
    const parsed = invokeBodySchema.safeParse({ messages: [{ content: 'no role here' }] });
    assert.equal(parsed.success, false);
  });

  it('rejects a non-boolean stream flag', () => {
    const parsed = invokeBodySchema.safeParse({ stream: 'yes' });
    assert.equal(parsed.success, false);
  });
});

describe('InvokeModelUseCase / applySlidingWindow (agentic loop context cap)', () => {
  const msg = (role: string, i: number) => ({ role, n: i });

  it('is a no-op when message count is within the window', () => {
    const messages = [msg('user', 0), msg('assistant', 1)];
    const out = applySlidingWindow(messages, AGENTIC_CONTEXT_WINDOW);
    assert.deepEqual(out, messages);
    assert.equal(out, messages, 'returns the same reference when nothing to trim');
  });

  it('keeps only the most recent `windowSize` messages when there is no system head', () => {
    const messages = Array.from({ length: 10 }, (_v, i) => msg('user', i));
    const out = applySlidingWindow(messages, 4);
    assert.equal(out.length, 4);
    assert.deepEqual(
      out.map((m) => m.n),
      [6, 7, 8, 9],
      'must retain the LAST windowSize messages',
    );
  });

  it('always preserves a leading system message and trims from the middle', () => {
    const messages = [
      msg('system', 0),
      ...Array.from({ length: 9 }, (_v, i) => msg('user', i + 1)),
    ];
    const out = applySlidingWindow(messages, 4);
    assert.equal(out.length, 4);
    assert.equal(out[0]?.role, 'system', 'system prefix must survive');
    assert.equal(out[0]?.n, 0);
    assert.deepEqual(
      out.slice(1).map((m) => m.n),
      [7, 8, 9],
      'remaining slots are the most recent messages',
    );
  });

  it('bounds growth: repeatedly appending 2 msgs/turn never exceeds the window', () => {
    let messages = [msg('system', 0), msg('user', 1)];
    for (let turn = 0; turn < 50; turn++) {
      messages.push(msg('assistant', 1000 + turn));
      messages.push(msg('tool', 2000 + turn));
      messages = applySlidingWindow(messages, AGENTIC_CONTEXT_WINDOW);
      assert.ok(
        messages.length <= AGENTIC_CONTEXT_WINDOW,
        `length ${messages.length} must stay within the window`,
      );
    }
    assert.equal(messages[0]?.role, 'system', 'system anchor is never evicted');
  });
});

describe('InvokeModelUseCase / executeImpl boundary validation', () => {
  function factoryWith(modelId: string): ModelFactory {
    const factory = new ModelFactory();
    // A dummy strategy that must NEVER be reached when the body is invalid.
    factory.register(modelId, () => ({
      process: async () => {
        throw new Error('strategy.process should not run for an invalid body');
      },
    }));
    return factory;
  }

  it('rejects an invalid body with a 400 BEFORE invoking the strategy/cache', async () => {
    const useCase = new InvokeModelUseCase(factoryWith('m1'));
    await assert.rejects(
      () =>
        useCase.execute({
          modelId: 'm1',
          body: { messages: 'not-an-array' } as never,
          context: {},
        }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError, 'should throw an ApiError');
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /invalid invoke body/i);
        return true;
      },
    );
  });

  it('still rejects an unregistered model with a 404 (order: existence before body)', async () => {
    const useCase = new InvokeModelUseCase(new ModelFactory());
    await assert.rejects(
      () => useCase.execute({ modelId: 'ghost', body: {}, context: {} }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 404);
        return true;
      },
    );
  });
});
