import { Request, Response, NextFunction } from 'express';
import { logger } from '../../core/logger.js';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

// Memory cache for rate limiting (Native Map)
const rateLimitCache = new Map<string, RateLimitRecord>();

/**
 * Native Memory-based Rate Limiter using Sliding Window logic
 * Built-in over dependencies: avoids using redis or external packages for simple API limiting.
 */
export const rateLimiter = (options: { windowMs: number; max: number }) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Identifier: IP or API Key
    const identifier = (req.user?.apiKeyId || req.ip || 'unknown-ip') as string;
    const now = Date.now();

    const record = rateLimitCache.get(identifier);

    if (!record) {
      // First request from this identifier
      rateLimitCache.set(identifier, {
        count: 1,
        resetTime: now + options.windowMs,
      });
      return next();
    }

    if (now > record.resetTime) {
      // Window expired, reset
      record.count = 1;
      record.resetTime = now + options.windowMs;
      return next();
    }

    // Inside window
    record.count++;
    if (record.count > options.max) {
      logger.warn(`Rate limit exceeded for ${identifier}`, { ip: req.ip, path: req.path });
      res.status(429).json({
        success: false,
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfterMs: record.resetTime - now
      });
      return;
    }

    next();
  };
};

// Periodically clean up expired records to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitCache.entries()) {
    if (now > record.resetTime) {
      rateLimitCache.delete(key);
    }
  }
}, 60000).unref(); // .unref() ensures this interval doesn't keep the event loop alive
