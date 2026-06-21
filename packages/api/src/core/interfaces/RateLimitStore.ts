/**
 * Persistence backend for the request-count rate limiter.
 *
 * Abstracting the store lets the limiter run against an in-memory `Map`
 * (single-node, fast, lost on restart) or a persistent backend (SQLite today;
 * a Redis token-bucket adapter could implement the same interface) without the
 * middleware caring which one is wired in.
 *
 * `hit()` is the atomic primitive: it records one request for `identifier`
 * inside the current window and returns the post-increment state, so the caller
 * never needs a separate read-then-write (which would race under concurrency).
 */
export interface RateLimitState {
  /** Number of requests recorded for the identifier in the current window. */
  count: number;
  /** Epoch ms at which the current window resets. */
  resetTime: number;
}

export interface RateLimitStore {
  /**
   * Atomically record one request and return the new window state.
   * @param identifier - API key id or IP
   * @param windowMs   - Window length in ms (used to open a fresh window)
   */
  hit(identifier: string, windowMs: number): Promise<RateLimitState>;
}
