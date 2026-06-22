import { Request, Response, NextFunction } from 'express';
import { logger } from '../../core/logger.js';
import { getContext } from '../../core/async-context.js';
import { CPUWorkerService } from '../../infrastructure/workers/workerPool.js';
import type { SafetyVerdict } from '../../infrastructure/workers/safetyWorker.js';

/**
 * AI Safety Firewall Middleware
 *
 * - PII Masking: redacts emails / credit cards in-place (cheap, synchronous).
 * - Prompt-injection / toxicity / DLP classification: offloaded to a Worker
 *   Thread (see safetyWorker.ts) so a large or adversarial payload can never
 *   block the Event Loop. The worker's `classify()` is the SLM-ready seam.
 *
 * Degradation posture: PII masking is mandatory and always runs. The heavier
 * classification is best-effort enrichment — if the worker errors or times out
 * we log loudly and FAIL OPEN (let the request proceed) rather than take the
 * gateway down on a classifier hiccup. This is a deliberate availability choice
 * for a *content* filter and is distinct from auth / rate-limit, which fail
 * CLOSED. Flip `FAIL_CLOSED` to true for a stricter deployment.
 */
const FAIL_CLOSED = false;

export const aiSafetyFirewall = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const ctx = getContext();
  const traceId = ctx?.traceId || 'unknown';

  if (!req.body || typeof req.body !== 'object') {
    return next();
  }

  // ── PII masking (cheap, in-place) ──────────────────────────────────────────
  const maskPII = (text: string): string => {
    if (typeof text !== 'string') return text;
    let masked = text.replace(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      '[REDACTED_EMAIL]',
    );
    masked = masked.replace(/\b(?:\d[ -]*?){13,16}\b/g, '[REDACTED_CC]');
    return masked;
  };

  const traverseAndMask = (obj: any): any => {
    if (typeof obj === 'string') return maskPII(obj);
    if (Array.isArray(obj)) return obj.map(traverseAndMask);
    if (typeof obj === 'object' && obj !== null) {
      const newObj: any = {};
      for (const [key, value] of Object.entries(obj)) {
        newObj[key] = traverseAndMask(value);
      }
      return newObj;
    }
    return obj;
  };

  req.body = traverseAndMask(req.body);

  // ── Heavy classification (off the Event Loop, in a Worker Thread) ───────────
  // The stringify + scan can be expensive on a large body; running it in the
  // pool keeps p99 latency on other requests flat. classify() in the worker is
  // the boundary a real SLM (Phi-3.5 / Llama-Guard) would slot into.
  const promptContent = JSON.stringify(req.body);

  let verdict: SafetyVerdict;
  try {
    verdict = (await CPUWorkerService.classifySafety(promptContent)) as SafetyVerdict;
  } catch (error) {
    logger.error(
      'AI Safety Firewall classification failed in worker',
      { traceId, path: req.path, failClosed: FAIL_CLOSED },
      error instanceof Error ? error : new Error(String(error)),
    );
    if (FAIL_CLOSED) {
      res.status(503).json({
        error: 'Service Unavailable',
        message: 'Safety classification is temporarily unavailable.',
        code: 'ERR_AI_SAFETY_UNAVAILABLE',
      });
      return;
    }
    // Fail open: PII is already masked; let the request through.
    return next();
  }

  if (verdict.flagged) {
    logger.warn('AI Safety Firewall blocked request', {
      traceId,
      path: req.path,
      category: verdict.category,
      score: verdict.score,
      reason: verdict.reason,
    });

    res.status(403).json({
      error: 'Forbidden',
      message: 'Request blocked by AI Safety Firewall (Policy Violation)',
      code: 'ERR_AI_SAFETY_VIOLATION',
    });
    return;
  }

  logger.info('AI Safety Firewall validation passed', {
    traceId,
    category: verdict.category,
    score: verdict.score,
  });
  next();
};
