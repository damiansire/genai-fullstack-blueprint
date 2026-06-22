import { Router, Request, Response, RequestHandler } from 'express';
import { dbService } from '../../infrastructure/database/db.js';
import { logger } from '../../core/logger.js';
import { apiKeyAuth } from '../middleware/apiKeyAuth.js';

/**
 * User routes (token quota dashboard).
 *
 * Security (P1 fix): behind `apiKeyAuth`, and the quota identifier is the
 * authenticated key identity — never a hardcoded `'default-tenant'`, so each
 * caller only ever sees their own usage.
 */
export const createUserRoutes = (postAuthChain: RequestHandler[] = []): Router => {
  const router = Router();

  router.use(apiKeyAuth, ...postAuthChain);

  // GET /api/user/quota — Token Dashboard (scoped to the authenticated key)
  router.get('/quota', (req: Request, res: Response) => {
    try {
      const identifier = req.user?.apiKeyId;
      if (!identifier) {
        res.status(401).json({ error: 'Authenticated identity is required.' });
        return;
      }

      const stmt = (dbService as any).proxiedDb.prepare(
        'SELECT tokens, last_refill FROM rate_limit_tokens WHERE identifier = ?',
      );
      const row = stmt.get(identifier);

      const maxTokens = 50000; // Configured monthly limit
      const currentTokens = row ? row.tokens : maxTokens;

      res.json({
        tenantId: identifier,
        maxTokens,
        availableTokens: currentTokens,
        usedTokens: maxTokens - currentTokens,
        lastRefill: row ? row.last_refill : new Date().toISOString(),
        usagePercentage: Math.round(((maxTokens - currentTokens) / maxTokens) * 100),
      });
    } catch (err) {
      logger.error(
        'Failed to fetch user quota',
        {},
        err instanceof Error ? err : new Error(String(err)),
      );
      res.status(500).json({ error: 'Failed to fetch user quota' });
    }
  });

  return router;
};
