import type { RateLimitStore, RateLimitState } from '../../core/interfaces/RateLimitStore.js';
import { hitRequestLimit } from '../database/db.js';

/**
 * Persistent request-count store backed by SQLite (the DB the project already
 * ships). The count survives restarts and is shared across every event-loop on
 * a single node — unlike the in-memory Map, which is per-process and volatile.
 *
 * The atomic UPSERT lives in the DB layer (`hitRequestLimit`) so concurrent
 * requests can't read-then-write a stale count.
 *
 * Note: this is single-node persistence, not a cross-machine distributed limiter
 * (that would need Redis). The interface is deliberately the same so a Redis
 * token-bucket adapter could drop in without touching the middleware.
 */
export class SqliteRateLimitStore implements RateLimitStore {
  public async hit(identifier: string, windowMs: number): Promise<RateLimitState> {
    // Throws on DB failure → the limiter middleware fails closed.
    return hitRequestLimit(identifier, windowMs);
  }
}
