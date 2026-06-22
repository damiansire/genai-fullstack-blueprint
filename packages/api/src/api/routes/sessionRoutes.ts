import { Router, Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { dbService } from '../../infrastructure/database/db.js';
import { logger } from '../../core/logger.js';
import { randomUUID } from 'node:crypto';
import { apiKeyAuth } from '../middleware/apiKeyAuth.js';
import { ApiError } from '../../core/ApiError.js';

/**
 * Session (chat history) routes.
 *
 * Security (P1 fix): every route is behind `apiKeyAuth` (router.use), and the
 * tenant is derived from the authenticated key identity (`req.user.apiKeyId`) —
 * never a hardcoded `'default-tenant'`. All queries are scoped by tenant so one
 * key can never read or mutate another tenant's sessions/messages (no IDOR).
 */

const createSessionSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

const addMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string().min(1).max(100_000),
});

/** Derive the tenant from the authenticated API key. Never trust client input. */
function tenantOf(req: Request): string {
  const id = req.user?.apiKeyId;
  if (!id) {
    // apiKeyAuth runs first and guarantees this, but fail closed regardless.
    throw ApiError.unauthorized('Authenticated identity is required.');
  }
  return id;
}

/** Confirms the session belongs to the caller's tenant (ownership check). */
function assertSessionOwnership(sessionId: string, tenantId: string): void {
  const row = (dbService as any).proxiedDb
    .prepare('SELECT id FROM sessions WHERE id = ? AND tenant_id = ?')
    .get(sessionId, tenantId);
  if (!row) {
    throw ApiError.notFound('Session not found.');
  }
}

export const createSessionRoutes = (postAuthChain: RequestHandler[] = []): Router => {
  const router = Router();

  // Auth is the front gate for the whole router, then any cross-cutting chain
  // (rate limiter) — which now keys by the authenticated req.user.apiKeyId.
  router.use(apiKeyAuth, ...postAuthChain);

  // GET /api/sessions — lists the caller's chat sessions
  router.get('/', (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      const stmt = (dbService as any).proxiedDb.prepare(
        'SELECT * FROM sessions WHERE tenant_id = ? ORDER BY updated_at DESC',
      );
      const sessions = stmt.all(tenantId);
      res.json(sessions);
    } catch (err) {
      if (err instanceof ApiError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      logger.error(
        'Failed to fetch sessions',
        {},
        err instanceof Error ? err : new Error(String(err)),
      );
      res.status(500).json({ error: 'Failed to fetch sessions' });
    }
  });

  // POST /api/sessions — creates a new chat session for the caller's tenant
  router.post('/', (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      const parsed = createSessionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid session body', details: parsed.error.flatten() });
        return;
      }

      const title = parsed.data.title ?? 'New Chat';
      const id = randomUUID();
      const now = new Date().toISOString();

      const stmt = (dbService as any).proxiedDb.prepare(
        'INSERT INTO sessions (id, tenant_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      );
      stmt.run(id, tenantId, title, now, now);

      res.status(201).json({ id, title, createdAt: now });
    } catch (err) {
      if (err instanceof ApiError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      logger.error(
        'Failed to create session',
        {},
        err instanceof Error ? err : new Error(String(err)),
      );
      res.status(500).json({ error: 'Failed to create session' });
    }
  });

  // GET /api/sessions/:id/messages — messages for a session the caller owns
  router.get('/:id/messages', (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      const { id } = req.params;
      assertSessionOwnership(id!, tenantId);

      const stmt = (dbService as any).proxiedDb.prepare(
        'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC',
      );
      const messages = stmt.all(id);
      res.json(messages);
    } catch (err) {
      if (err instanceof ApiError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      logger.error(
        'Failed to fetch messages',
        {},
        err instanceof Error ? err : new Error(String(err)),
      );
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  });

  // POST /api/sessions/:id/messages — adds a message to a session the caller owns
  router.post('/:id/messages', (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      const { id } = req.params;
      assertSessionOwnership(id!, tenantId);

      const parsed = addMessageSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid message body', details: parsed.error.flatten() });
        return;
      }
      const { role, content } = parsed.data;
      const msgId = randomUUID();
      const now = new Date().toISOString();

      const insertMsg = (dbService as any).proxiedDb.prepare(
        'INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
      );
      insertMsg.run(msgId, id, role, content, now);

      const updateSession = (dbService as any).proxiedDb.prepare(
        'UPDATE sessions SET updated_at = ? WHERE id = ? AND tenant_id = ?',
      );
      updateSession.run(now, id, tenantId);

      res.status(201).json({ id: msgId, role, content, createdAt: now });
    } catch (err) {
      if (err instanceof ApiError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      logger.error(
        'Failed to add message',
        {},
        err instanceof Error ? err : new Error(String(err)),
      );
      res.status(500).json({ error: 'Failed to add message' });
    }
  });

  return router;
};
