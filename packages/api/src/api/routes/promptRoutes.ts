import { Router, Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { dbService } from '../../infrastructure/database/db.js';
import { logger } from '../../core/logger.js';
import { apiKeyAuth, requirePermissions } from '../middleware/apiKeyAuth.js';

/**
 * Admin prompt routes.
 *
 * Security (P1 fix): system prompts are injected into EVERY downstream model
 * invocation, so read/write of this table is an admin-only operation. The router
 * is gated by `apiKeyAuth` AND `requirePermissions(['admin'])` — an anonymous or
 * non-admin caller can no longer enumerate or overwrite system prompts
 * (persistent prompt-injection primitive). Bodies are validated with zod.
 */

const updatePromptSchema = z.object({
  content: z.string().min(1).max(50_000),
  description: z.string().max(2_000).optional(),
});

export const createPromptRoutes = (postAuthChain: RequestHandler[] = []): Router => {
  const router = Router();

  // Auth + admin permission are the front gate for the whole router, then any
  // cross-cutting chain (rate limiter) keyed by the authenticated identity.
  router.use(apiKeyAuth, requirePermissions(['admin']), ...postAuthChain);

  // GET /api/admin/prompts
  router.get('/', (_req: Request, res: Response) => {
    try {
      const stmt = (dbService as any).proxiedDb.prepare('SELECT * FROM prompts ORDER BY name ASC');
      const prompts = stmt.all();
      res.json(prompts);
    } catch (err) {
      logger.error('Failed to fetch prompts', {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: 'Failed to fetch prompts' });
    }
  });

  // PUT /api/admin/prompts/:name
  router.put('/:name', (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const parsed = updatePromptSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid prompt body', details: parsed.error.flatten() });
        return;
      }
      const { content, description } = parsed.data;

      const stmt = (dbService as any).proxiedDb.prepare(
        'INSERT OR REPLACE INTO prompts (name, content, description, updated_at) VALUES (?, ?, ?, ?)'
      );
      stmt.run(name, content, description ?? null, new Date().toISOString());

      res.json({ success: true, name, message: 'Prompt updated successfully' });
    } catch (err) {
      logger.error('Failed to update prompt', {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: 'Failed to update prompt' });
    }
  });

  return router;
};
