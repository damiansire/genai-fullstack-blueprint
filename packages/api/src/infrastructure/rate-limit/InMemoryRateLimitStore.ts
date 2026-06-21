import type { RateLimitStore, RateLimitState } from '../../core/interfaces/RateLimitStore.js';

interface Record_ {
  count: number;
  resetTime: number;
}

/**
 * In-memory request-count store (native Map).
 * Fast and dependency-free, but per-process and lost on restart — fine for a
 * single-node dev/scaffold deployment. Use {@link SqliteRateLimitStore} when
 * the count must survive restarts or be shared across workers on one box.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private cache = new Map<string, Record_>();

  constructor() {
    // Sweep expired records so the Map doesn't grow unbounded.
    setInterval(() => {
      const now = Date.now();
      for (const [key, rec] of this.cache.entries()) {
        if (now > rec.resetTime) this.cache.delete(key);
      }
    }, 60_000).unref();
  }

  public async hit(identifier: string, windowMs: number): Promise<RateLimitState> {
    const now = Date.now();
    const rec = this.cache.get(identifier);

    if (!rec || now > rec.resetTime) {
      const fresh: Record_ = { count: 1, resetTime: now + windowMs };
      this.cache.set(identifier, fresh);
      return { ...fresh };
    }

    rec.count++;
    return { count: rec.count, resetTime: rec.resetTime };
  }
}
