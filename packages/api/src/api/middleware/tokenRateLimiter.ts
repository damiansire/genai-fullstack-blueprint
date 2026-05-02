import { Request, Response, NextFunction } from 'express';
import { logger } from '../../core/logger.js';
import { TokenStore } from '../../core/interfaces/TokenStore.js';

/**
 * Token-based rate limiting middleware.
 * This checks if the user has exceeded their token budget for the current window.
 * The actual consumption of tokens happens in the controller after the LLM responds,
 * because we do not know the exact token cost upfront.
 */
export const tokenRateLimiter = (store: TokenStore, options: { windowMs: number; maxTokens: number }) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Identifier: API Key or IP as fallback
      const identifier = (req.user?.apiKeyId || req.ip || 'unknown-ip') as string;
      
      const currentTokens = await store.getConsumedTokens(identifier, options.windowMs);
      
      if (currentTokens >= options.maxTokens) {
        logger.warn(`Token rate limit exceeded for ${identifier}`, { 
          ip: req.ip, 
          path: req.path,
          currentTokens,
          maxTokens: options.maxTokens
        });
        
        res.status(429).json({
          success: false,
          error: 'Token Limit Exceeded',
          message: 'You have exhausted your token budget for this time window. Please try again later.',
          retryAfterMs: options.windowMs // In a real sliding window, this would be computed exactly
        });
        return;
      }

      // Attach the store and window to res.locals so the controller can easily consume tokens
      // after the LLM call succeeds.
      res.locals['tokenStore'] = store;
      res.locals['rateLimitWindowMs'] = options.windowMs;
      res.locals['rateLimitIdentifier'] = identifier;
      
      next();
    } catch (error) {
      logger.error('Error in token rate limiter', {}, error instanceof Error ? error : new Error(String(error)));
      // Fail open to avoid breaking the application if the store temporarily fails
      next();
    }
  };
};
