import { Request, Response, NextFunction } from 'express';
import { logger } from '../../core/logger.js';
import type { RateLimitStore } from '../../core/interfaces/RateLimitStore.js';
import { InMemoryRateLimitStore } from '../../infrastructure/rate-limit/InMemoryRateLimitStore.js';

/**
 * Request-count rate limiter.
 *
 * The counting backend is abstracted behind {@link RateLimitStore}: pass an
 * `InMemoryRateLimitStore` (single-node, volatile) or a `SqliteRateLimitStore`
 * (persistent across restarts) — or any future Redis adapter — without changing
 * this middleware. Defaults to in-memory for backwards compatibility.
 *
 * Fail-closed: if the store throws (e.g. a DB hiccup with the SQLite backend) we
 * deny the request with 503 rather than silently disabling the limit, matching
 * the token limiter's Zero-Trust posture.
 *
 * Built-in over dependencies: no `express-rate-limit`.
 */
export const rateLimiter = (options: { windowMs: number; max: number; store?: RateLimitStore }) => {
  const store: RateLimitStore = options.store ?? new InMemoryRateLimitStore();

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Identity: API key (set by apiKeyAuth, which must run BEFORE this) or IP.
    const identifier = (req.user?.apiKeyId || req.ip || 'unknown-ip') as string;

    let state;
    try {
      state = await store.hit(identifier, options.windowMs);
    } catch (error) {
      logger.error(
        'Rate limit store unavailable; failing closed',
        { identifier, path: req.path },
        error instanceof Error ? error : new Error(String(error)),
      );
      res.status(503).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Rate limiting is temporarily unavailable. Please retry shortly.',
      });
      return;
    }

    if (state.count > options.max) {
      const retryAfterMs = Math.max(0, state.resetTime - Date.now());
      logger.warn(`Rate limit exceeded for ${identifier}`, { ip: req.ip, path: req.path });
      res.setHeader('Retry-After', Math.ceil(retryAfterMs / 1000).toString());
      res.status(429).json({
        success: false,
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfterMs,
      });
      return;
    }

    next();
  };
};
