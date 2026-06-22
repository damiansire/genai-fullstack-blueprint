/**
 * SemanticCacheService — Patrón 3: sqlite-vec int8 Quantized Semantic Cache
 *
 * Orchestrates the full semantic cache lookup and storage flow:
 *
 *   1. LOOKUP:
 *      prompt text → EmbeddingService.generateEmbedding() [Float32Array]
 *              ↓
 *      DatabaseService.findSemanticMatch()
 *        → quantizeToInt8() [Float32Array → Int8Array, 4x smaller]
 *        → sqlite-vec KNN query [returns nearest rowid + L2 distance]
 *        → distance < threshold? → return cached response
 *
 *   2. STORE (after a real LLM call):
 *      response + embedding → storeSemanticVector()
 *        → quantizeToInt8() + INSERT INTO semantic_vectors [rowid, int8[768]]
 *        → INSERT INTO semantic_cache_meta [vector_id, hash, response, model_id]
 *
 * Design decisions:
 *   - Embedding is generated ONCE per request and reused for both lookup and store.
 *     This avoids a second transformer inference pass.
 *   - The service is a Singleton (getInstance pattern, matching DatabaseService).
 *   - When sqlite-vec is not loaded (isVecEnabled() = false), all methods
 *     return null/void silently — zero impact on the happy path.
 *   - vectorId is derived from Date.now() XOR a random 16-bit int to reduce
 *     collision probability without requiring a separate ID table.
 *
 * Reference:
 *   https://alexgarcia.xyz/sqlite-vec/api-reference.html
 *   https://arxiv.org/abs/2309.07305 (scalar quantization error bounds)
 */

import { createHash } from 'node:crypto';
import { embeddingService } from '../services/embeddingService.js';
import { isVecEnabled, findSemanticMatch, storeSemanticVector } from './database/db.js';
import { logger } from '../core/logger.js';
import { getContext } from '../core/async-context.js';

export interface SemanticCacheLookupResult {
  hit: true;
  response: any;
  modelId: string;
  hitCount: number;
  source: 'semantic';
}

export interface SemanticCacheMiss {
  hit: false;
  /** The embedding generated during the lookup — reuse it when storing. */
  embedding: Float32Array;
  promptHash: string;
}

export type SemanticCacheResult = SemanticCacheLookupResult | SemanticCacheMiss;

/**
 * Similarity threshold (L2 distance in int8 space).
 * A threshold of 0.15 corresponds to approximately 0.93 cosine similarity.
 * Increase this for more aggressive caching (more false hits).
 * Decrease for stricter matching (fewer false hits, less cache savings).
 */
const DEFAULT_DIST_THRESHOLD = 0.15;

class SemanticCacheService {
  private static instance: SemanticCacheService;

  private constructor() {}

  public static getInstance(): SemanticCacheService {
    if (!SemanticCacheService.instance) {
      SemanticCacheService.instance = new SemanticCacheService();
    }
    return SemanticCacheService.instance;
  }

  /**
   * Looks up a semantically similar cached response for the given prompt.
   *
   * Returns a HIT with the cached response if a near-duplicate exists,
   * or a MISS with the generated embedding (to be reused for storage).
   *
   * When sqlite-vec is not available, always returns MISS with a dummy embedding.
   *
   * @param promptText  The full prompt string to embed and search.
   * @param modelId     Used for logging context only (not part of the vector query).
   */
  async lookup(promptText: string, modelId: string): Promise<SemanticCacheResult> {
    const traceId = getContext()?.traceId;

    // Derive a deterministic hash for this exact prompt (used as a secondary key)
    const promptHash = createHash('sha256').update(promptText).digest('hex');

    if (!isVecEnabled()) {
      // sqlite-vec not loaded — skip silently (graceful degradation)
      return { hit: false, embedding: new Float32Array(768), promptHash };
    }

    let embedding: Float32Array;

    try {
      embedding = await embeddingService.generateEmbedding(promptText);
    } catch (err) {
      logger.warn(
        '[SemanticCache] Embedding generation failed, falling back to exact-match cache',
        {
          modelId,
          traceId,
          error: err instanceof Error ? err.message : String(err),
        },
      );
      return { hit: false, embedding: new Float32Array(768), promptHash };
    }

    const match = findSemanticMatch(embedding, 3, DEFAULT_DIST_THRESHOLD);

    if (match) {
      logger.info('[SemanticCache] Semantic HIT', {
        modelId,
        traceId,
        hitCount: match.hitCount,
        cachedModel: match.modelId,
      });
      return {
        hit: true,
        response: match.response,
        modelId: match.modelId,
        hitCount: match.hitCount,
        source: 'semantic',
      };
    }

    // MISS — return the embedding so the caller can reuse it for storage
    logger.info('[SemanticCache] Semantic MISS', { modelId, traceId });
    return { hit: false, embedding, promptHash };
  }

  /**
   * Stores an LLM response alongside its int8-quantized embedding in sqlite-vec.
   * Call this after a successful (non-cached) LLM response.
   *
   * Pass the `embedding` from the SemanticCacheMiss result to avoid a second
   * embedding inference pass.
   *
   * @param embedding   Float32Array from the MISS result.
   * @param promptHash  SHA-256 hash from the MISS result.
   * @param response    The LLM response object to cache.
   * @param modelId     The model that produced the response.
   */
  store(embedding: Float32Array, promptHash: string, response: object, modelId: string): void {
    if (!isVecEnabled()) return;

    // Compact vectorId: 47-bit timestamp XOR 16-bit random → fits in SQLite INTEGER
    const vectorId = (Date.now() & 0x7fffffffffff) ^ Math.floor(Math.random() * 65536);

    try {
      storeSemanticVector(vectorId, embedding, promptHash, response, modelId);
      logger.info('[SemanticCache] Response stored in semantic cache', {
        vectorId,
        modelId,
        promptHash: promptHash.slice(0, 8) + '...',
      });
    } catch (err) {
      // Non-critical: storage failure does not affect the response
      logger.warn('[SemanticCache] Failed to store in semantic cache', {
        modelId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export const semanticCache = SemanticCacheService.getInstance();
