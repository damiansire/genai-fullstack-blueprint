import { Router, Request, Response, NextFunction } from 'express';
import { apiKeyAuth } from '../middleware/apiKeyAuth.js';
import {
  ToolSearchUseCase,
  ToolGetByNameUseCase,
  RegisterToolUseCase,
} from '../../application/useCases/tool-search.usecase.js';
import { ApiError } from '../../core/ApiError.js';

/**
 * Tool Registry Routes — Patrón 1: JIT Tool Search
 *
 * Endpoints:
 *   POST   /api/tools/search      ← LLM calls this via the native `search_tools` tool
 *   GET    /api/tools/:name       ← Exact schema retrieval (used in agentic loops)
 *   POST   /api/tools/register    ← Add / update a tool definition at runtime
 *
 * These routes are protected by the same apiKeyAuth middleware as model routes.
 * The rateLimiter is applied at the parent mount point in server.ts.
 */
export function createToolRoutes(): Router {
  const router = Router();

  const toolSearchUseCase = new ToolSearchUseCase();
  const toolGetByNameUseCase = new ToolGetByNameUseCase();
  const registerToolUseCase = new RegisterToolUseCase();

  // ─── POST /api/tools/search ─────────────────────────────────────────────────
  // Primary JIT endpoint. The LLM emits tool_use: { name: "search_tools",
  // args: { query: "..." } }. The agentic loop in invoke-model.usecase.ts
  // calls this endpoint and injects the returned schemas at the END of the
  // context window so the static System Prompt prefix stays cache-valid.
  router.post(
    '/search',
    apiKeyAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { query, limit } = req.body as { query?: string; limit?: number };

        if (!query) {
          throw ApiError.badRequest('Body must include a "query" string');
        }

        const results = await toolSearchUseCase.execute({
          query,
          ...(limit !== undefined && { limit }),
        });

        // Return schemas formatted for direct injection into LLM context
        res.json({
          count: results.length,
          system_hint:
            'Inject these schemas at the end of the context window to preserve cache preamble.',
          tools: results,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ─── GET /api/tools/:name ────────────────────────────────────────────────────
  // Exact-match retrieval used during recursive agentic loops when the model
  // already knows the tool name and only needs the schema.
  router.get(
    '/:name',
    apiKeyAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { name } = req.params as { name: string };
        const tool = await toolGetByNameUseCase.execute({ name });
        res.json(tool);
      } catch (err) {
        next(err);
      }
    }
  );

  // ─── POST /api/tools/register ────────────────────────────────────────────────
  // Allows registering or updating tool definitions at runtime without a
  // server restart. Useful for plugin-based tool discovery.
  router.post(
    '/register',
    apiKeyAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dto = req.body as {
          name?: string;
          description?: string;
          schema?: object;
          category?: string;
        };
        const result = await registerToolUseCase.execute({
          name: dto.name ?? '',
          description: dto.description ?? '',
          schema: dto.schema ?? {},
          ...(dto.category !== undefined && { category: dto.category }),
        });
        res.status(201).json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
