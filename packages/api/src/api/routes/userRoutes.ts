import { Router, Request, Response } from 'express';
import { dbService } from '../../infrastructure/database/db.js';
import { logger } from '../../core/logger.js';

export const createUserRoutes = (): Router => {
  const router = Router();

  // GET /api/user/quota
  // Implements Point 4: Token Dashboard
  router.get('/quota', (req: Request, res: Response) => {
    try {
      // In a real SaaS, identifier comes from JWT (e.g., req.user.tenantId)
      // For scaffold purposes, we use a generic 'default-tenant' or fallback to IP
      const identifier = 'default-tenant'; 
      
      const stmt = (dbService as any).proxiedDb.prepare('SELECT tokens, last_refill FROM rate_limit_tokens WHERE identifier = ?');
      const row = stmt.get(identifier);

      const maxTokens = 50000; // Configured monthly limit
      const currentTokens = row ? row.tokens : maxTokens;
      
      res.json({
        tenantId: identifier,
        maxTokens,
        availableTokens: currentTokens,
        usedTokens: maxTokens - currentTokens,
        lastRefill: row ? row.last_refill : new Date().toISOString(),
        usagePercentage: Math.round(((maxTokens - currentTokens) / maxTokens) * 100)
      });
    } catch (err) {
      logger.error('Failed to fetch user quota', {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: 'Failed to fetch user quota' });
    }
  });

  return router;
};
