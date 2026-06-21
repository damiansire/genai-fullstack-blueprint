// Stability: 1 - Experimental (node:test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stableStringify } from './invoke-model.usecase.js';

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
