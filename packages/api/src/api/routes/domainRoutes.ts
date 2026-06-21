/**
 * Domain Routes — Patrones 7, 9, 10
 *
 * POST /domain/security/analyze    → Patrón 7: Security log analysis (MITRE ATT&CK)
 * GET  /domain/telemetry/devices   → Patrón 9: List IoT devices
 * GET  /domain/telemetry/stream    → Patrón 9: IoT SSE telemetry stream
 * POST /domain/code/generate       → Patrón 10: Code generation + quality feedback loop
 *
 * All routes share:
 *   - API key authentication (timingSafeEqual)
 *   - AsyncLocalStorage root context (Patrón 5)
 *   - Structured JSON error responses
 */

import { Router, Request, Response } from 'express';
import { securityAnalysisUseCase } from '../../application/useCases/security-analysis.usecase.js';
import { telemetryStreamUseCase, DEVICES } from '../../application/useCases/telemetry-stream.usecase.js';
import { codeGenerationUseCase, type SupportedLanguage } from '../../application/useCases/code-generation.usecase.js';
import { contextCacheUseCase } from '../../application/useCases/context-cache.usecase.js';
import { apiKeyAuth } from '../middleware/apiKeyAuth.js';
import { logger } from '../../core/logger.js';

export function createDomainRoutes(): Router {
  const router = Router();

  // ──────────────────────────────────────────────────────────────────────────
  // Patrón 7: Security Analysis
  // POST /domain/security/analyze
  // Body: { logs: string }
  // ──────────────────────────────────────────────────────────────────────────
  router.post('/security/analyze', apiKeyAuth, async (req: Request, res: Response) => {
    const { logs } = req.body as { logs?: string };

    if (!logs || typeof logs !== 'string') {
      res.status(400).json({ error: 'Request body must contain a `logs` string field.' });
      return;
    }

    if (logs.length > 500_000) {
      res.status(413).json({ error: 'Log payload exceeds 500KB limit.' });
      return;
    }

    try {
      const report = await securityAnalysisUseCase.execute(logs);
      res.json(report);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[Domain] Security analysis failed', { error: message });
      res.status(500).json({ error: 'Security analysis failed', detail: message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Patrón 9: IoT Telemetry — Device List
  // GET /domain/telemetry/devices
  // ──────────────────────────────────────────────────────────────────────────
  router.get('/telemetry/devices', apiKeyAuth, (_req: Request, res: Response) => {
    res.json({ devices: DEVICES });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Patrón 9: IoT Telemetry — SSE Stream
  // GET /domain/telemetry/stream?devices=TEMP-WH-001,HUM-WH-001
  //
  // Each SSE event is a TelemetryFrame JSON payload.
  // Client disconnect aborts the AsyncGenerator via AbortController.
  // ──────────────────────────────────────────────────────────────────────────
  router.get('/telemetry/stream', apiKeyAuth, async (req: Request, res: Response) => {
    const deviceParam = (req.query['devices'] as string | undefined) ?? '';
    const deviceIds = deviceParam
      ? deviceParam.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send device list as first event (for UI bootstrap)
    const activeDevices = deviceIds.length > 0
      ? DEVICES.filter(d => deviceIds.includes(d.id))
      : DEVICES;
    res.write(`event: devices\ndata: ${JSON.stringify(activeDevices)}\n\n`);

    // Abort signal: fires when the client disconnects
    const ac = new AbortController();
    req.on('close', () => ac.abort());

    try {
      for await (const frame of telemetryStreamUseCase.stream(deviceIds, ac.signal)) {
        if (res.writableEnded) break;
        res.write(`data: ${JSON.stringify(frame)}\n\n`);
      }
    } catch (err) {
      if (!ac.signal.aborted) {
        logger.error('[Domain] Telemetry stream error', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      if (!res.writableEnded) res.end();
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Patrón 10: Code Generation + Quality Feedback Loop
  // POST /domain/code/generate
  // Body: { spec: string, language?: SupportedLanguage }
  // ──────────────────────────────────────────────────────────────────────────
  router.post('/code/generate', apiKeyAuth, async (req: Request, res: Response) => {
    const { spec, language = 'typescript' } = req.body as {
      spec?: string;
      language?: SupportedLanguage;
    };

    if (!spec || typeof spec !== 'string') {
      res.status(400).json({ error: 'Request body must contain a `spec` string field.' });
      return;
    }

    if (spec.length > 4000) {
      res.status(413).json({ error: 'Spec exceeds 4000 character limit.' });
      return;
    }

    const validLanguages: SupportedLanguage[] = ['typescript', 'javascript', 'python', 'go', 'rust', 'sql'];
    if (!validLanguages.includes(language)) {
      res.status(400).json({
        error: `Unsupported language: ${language}`,
        supported: validLanguages,
      });
      return;
    }

    try {
      const result = await codeGenerationUseCase.execute({ spec, language });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[Domain] Code generation failed', { error: message });
      res.status(500).json({ error: 'Code generation failed', detail: message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Patrón 2: Gemini Context Caching
  // POST /domain/context-cache
  // GET  /domain/context-cache/:cacheId
  // ──────────────────────────────────────────────────────────────────────────
  router.post('/context-cache', apiKeyAuth, async (req: Request, res: Response) => {
    const { fileName, mimeType, sizeBytes } = req.body as {
      fileName?: string;
      mimeType?: string;
      sizeBytes?: number;
    };

    try {
      const result = await contextCacheUseCase.execute({
        action: 'create',
        fileName,
        mimeType,
        sizeBytes
      });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[Domain] Context Cache creation failed', { error: message });
      res.status(500).json({ error: 'Context Cache creation failed', detail: message });
    }
  });

  router.get('/context-cache/:cacheId', apiKeyAuth, async (req: Request, res: Response) => {
    const { cacheId } = req.params;
    
    try {
      const result = await contextCacheUseCase.execute({
        action: 'get',
        cacheId
      });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[Domain] Context Cache get failed', { cacheId, error: message });
      res.status(404).json({ error: 'Context Cache get failed', detail: message });
    }
  });

  return router;
}
