import { Router, Request, Response } from 'express';
import { dbService } from '../../infrastructure/database/db.js';
import { logger } from '../../core/logger.js';

export const createPromptRoutes = (): Router => {
  const router = Router();

  // GET /api/admin/prompts
  router.get('/', (_req: Request, res: Response) => {
    try {
      // In a real scenario we'd use prepared statements in db.ts
      // For this implementation, we use direct execution
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
      const { content, description } = req.body;
      
      const stmt = (dbService as any).proxiedDb.prepare(
        'INSERT OR REPLACE INTO prompts (name, content, description, updated_at) VALUES (?, ?, ?, ?)'
      );
      stmt.run(name, content, description, new Date().toISOString());
      
      res.json({ success: true, name, message: 'Prompt updated successfully' });
    } catch (err) {
      logger.error('Failed to update prompt', {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: 'Failed to update prompt' });
    }
  });

  return router;
};
