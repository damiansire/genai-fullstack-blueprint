import { Router, Request, Response } from 'express';
import { dbService } from '../../infrastructure/database/db.js';
import { logger } from '../../core/logger.js';
import { randomUUID } from 'node:crypto';

export const createSessionRoutes = (): Router => {
  const router = Router();

  // GET /api/sessions
  // Lists chat history sessions
  router.get('/', (req: Request, res: Response) => {
    try {
      const tenantId = 'default-tenant'; // Mock JWT tenant
      const stmt = (dbService as any).proxiedDb.prepare('SELECT * FROM sessions WHERE tenant_id = ? ORDER BY updated_at DESC');
      const sessions = stmt.all(tenantId);
      res.json(sessions);
    } catch (err) {
      logger.error('Failed to fetch sessions', {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: 'Failed to fetch sessions' });
    }
  });

  // POST /api/sessions
  // Creates a new chat session
  router.post('/', (req: Request, res: Response) => {
    try {
      const { title } = req.body;
      const tenantId = 'default-tenant';
      const id = randomUUID();
      const now = new Date().toISOString();
      
      const stmt = (dbService as any).proxiedDb.prepare(
        'INSERT INTO sessions (id, tenant_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      );
      stmt.run(id, tenantId, title || 'New Chat', now, now);
      
      res.status(201).json({ id, title, createdAt: now });
    } catch (err) {
      logger.error('Failed to create session', {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: 'Failed to create session' });
    }
  });

  // GET /api/sessions/:id/messages
  // Gets messages for a specific session
  router.get('/:id/messages', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const stmt = (dbService as any).proxiedDb.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC');
      const messages = stmt.all(id);
      res.json(messages);
    } catch (err) {
      logger.error('Failed to fetch messages', {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  });

  // POST /api/sessions/:id/messages
  // Adds a message to a session
  router.post('/:id/messages', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { role, content } = req.body;
      const msgId = randomUUID();
      const now = new Date().toISOString();

      // Transaction-like behavior
      const insertMsg = (dbService as any).proxiedDb.prepare(
        'INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
      );
      insertMsg.run(msgId, id, role, content, now);

      const updateSession = (dbService as any).proxiedDb.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?');
      updateSession.run(now, id);

      res.status(201).json({ id: msgId, role, content, createdAt: now });
    } catch (err) {
      logger.error('Failed to add message', {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: 'Failed to add message' });
    }
  });

  return router;
};
