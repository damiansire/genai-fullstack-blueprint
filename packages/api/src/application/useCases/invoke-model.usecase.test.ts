// Stability: 1 - Experimental (node:test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  stableStringify,
  invokeBodySchema,
  applySlidingWindow,
  AGENTIC_CONTEXT_WINDOW,
  InvokeModelUseCase,
} from './invoke-model.usecase.js';
import { ModelFactory } from '../../infrastructure/ai/factory.js';
import { ApiError } from '../../core/ApiError.js';

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
