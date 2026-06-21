// Stability: 1 - Experimental (node:test + module mocks)
//
// These tests mock the db.js and embeddingService boundaries so the cache
// orchestration logic can be exercised without a real SQLite/sqlite-vec
// database or a transformer inference pass. Run with
// --experimental-test-module-mocks (wired into the package "test" script).
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// --- Mutable test doubles the mocked modules delegate to ------------------
let vecEnabled = false;
let matchResult: any = null;
const storeCalls: any[] = [];
let storeThrows = false;
let embedImpl: (text: string) => Promise<Float32Array> = async () =>
  new Float32Array(768).fill(0.1);

mock.module('./database/db.js', {
  namedExports: {
    isVecEnabled: () => vecEnabled,
    findSemanticMatch: (..._args: any[]) => matchResult,
    storeSemanticVector: (...args: any[]) => {
      storeCalls.push(args);
      if (storeThrows) throw new Error('disk full');
    },
  },
});

mock.module('../services/embeddingService.js', {
  namedExports: {
    embeddingService: {
      generateEmbedding: (text: string) => embedImpl(text),
    },
  },
});

// Import AFTER the mocks are registered so the service binds to the doubles.
const { semanticCache } = await import('./semantic-cache.service.ts');

describe('SemanticCacheService', () => {
  beforeEach(() => {
    vecEnabled = false;
    matchResult = null;
    storeCalls.length = 0;
    storeThrows = false;
    embedImpl = async () => new Float32Array(768).fill(0.1);
  });

  describe('lookup', () => {
    it('returns a graceful MISS with a dummy embedding when vec is disabled', async () => {
      vecEnabled = false;
      const r = await semanticCache.lookup('hello world', 'gemini-1.5-flash');
      assert.equal(r.hit, false);
      assert.ok(r.hit === false && r.embedding instanceof Float32Array);
      assert.equal(r.hit === false && r.embedding.length, 768);
      // promptHash is deterministic sha256 hex (64 chars)
      assert.equal(r.hit === false && r.promptHash.length, 64);
    });

    it('produces a stable promptHash for the same prompt text', async () => {
      const a = await semanticCache.lookup('same prompt', 'm');
      const b = await semanticCache.lookup('same prompt', 'm');
      const c = await semanticCache.lookup('different prompt', 'm');
      assert.equal(a.hit, false);
      assert.equal(b.hit, false);
      assert.equal(
        a.hit === false && b.hit === false && a.promptHash === b.promptHash,
        true,
      );
      assert.notEqual(
        a.hit === false && c.hit === false ? a.promptHash : 'x',
        a.hit === false && c.hit === false ? c.promptHash : 'y',
      );
    });

    it('returns a HIT mapped from the db match when vec is enabled', async () => {
      vecEnabled = true;
      matchResult = {
        response: { text: 'cached answer' },
        modelId: 'gemini-1.5-pro',
        hitCount: 7,
      };
      const r = await semanticCache.lookup('what is 2+2', 'gemini-1.5-flash');
      assert.equal(r.hit, true);
      if (r.hit) {
        assert.deepEqual(r.response, { text: 'cached answer' });
        assert.equal(r.modelId, 'gemini-1.5-pro');
        assert.equal(r.hitCount, 7);
        assert.equal(r.source, 'semantic');
      }
    });

    it('returns a MISS carrying the real embedding when vec is enabled but no match', async () => {
      vecEnabled = true;
      matchResult = null;
      const realEmbed = new Float32Array(768).fill(0.42);
      embedImpl = async () => realEmbed;
      const r = await semanticCache.lookup('novel prompt', 'm');
      assert.equal(r.hit, false);
      // The caller must receive the *same* generated embedding instance to
      // reuse on store() (avoids a second inference pass).
      assert.equal(r.hit === false && r.embedding === realEmbed, true);
    });

    it('falls back to a graceful MISS when embedding generation throws', async () => {
      vecEnabled = true;
      embedImpl = async () => {
        throw new Error('transformer OOM');
      };
      const r = await semanticCache.lookup('boom prompt', 'm');
      assert.equal(r.hit, false);
      // Dummy embedding (all zeros) on the failure path.
      assert.equal(r.hit === false && r.embedding[0], 0);
    });
  });

  describe('store', () => {
    it('is a no-op when vec is disabled', () => {
      vecEnabled = false;
      semanticCache.store(new Float32Array(768), 'abc', { text: 'x' }, 'm');
      assert.equal(storeCalls.length, 0);
    });

    it('forwards embedding/hash/response/model to storeSemanticVector when enabled', () => {
      vecEnabled = true;
      const emb = new Float32Array(768).fill(0.2);
      semanticCache.store(emb, 'deadbeef', { text: 'answer' }, 'gemini-1.5-pro');
      assert.equal(storeCalls.length, 1);
      const [vectorId, passedEmb, hash, response, modelId] = storeCalls[0];
      assert.equal(typeof vectorId, 'number');
      assert.equal(passedEmb, emb);
      assert.equal(hash, 'deadbeef');
      assert.deepEqual(response, { text: 'answer' });
      assert.equal(modelId, 'gemini-1.5-pro');
    });

    it('swallows storage errors so a cache failure never breaks the response', () => {
      vecEnabled = true;
      storeThrows = true;
      // store() must not throw even though the underlying call does.
      assert.doesNotThrow(() =>
        semanticCache.store(new Float32Array(768), 'h', { text: 'x' }, 'm'),
      );
      assert.equal(storeCalls.length, 1);
    });
  });
});
