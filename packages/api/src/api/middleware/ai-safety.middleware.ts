import { Request, Response, NextFunction } from 'express';
import { logger } from '../../core/logger';
import { getContext } from '../../core/async-context';

/**
 * AI Safety Firewall Middleware
 * 
 * Implements Point 8 of the Enterprise Platform Capabilities:
 * - PII Masking: Redacts emails, credit cards, etc.
 * - Prompt Injection Defense: Analyzes prompt for malicious intent
 * - Toxicity Filters: Blocks inappropriate content
 */
export const aiSafetyFirewall = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const ctx = getContext();
  const traceId = ctx?.traceId || 'unknown';

  if (!req.body || typeof req.body !== 'object') {
    return next();
  }

  // Very basic simulated PII Masking (e.g., emails and SSN/Credit Cards)
  const maskPII = (text: string): string => {
    if (typeof text !== 'string') return text;
    let masked = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]');
    masked = masked.replace(/\b(?:\d[ -]*?){13,16}\b/g, '[REDACTED_CC]');
    return masked;
  };

  // Simulate traversing the body to mask PII
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

  // Apply PII masking to the request body
  req.body = traverseAndMask(req.body);

  // Basic keyword heuristic for prompt injection / toxicity.
  // NOTE: this is a simple substring match, NOT an SLM. It is trivially evaded
  // (synonyms, other languages, obfuscation) and prone to false positives. A
  // real Phi-3.5 / SLM classifier in a Worker Thread is on the roadmap.
  const promptContent = JSON.stringify(req.body).toLowerCase();
  const toxicityKeywords = ['ignore previous instructions', 'system prompt', 'bypass', 'hack', 'toxic'];

  const isToxicOrInjection = toxicityKeywords.some(keyword => promptContent.includes(keyword));

  if (isToxicOrInjection) {
    logger.warn('AI Safety Firewall blocked request due to suspected Prompt Injection or Toxicity', {
      traceId,
      path: req.path,
    });
    
    res.status(403).json({
      error: 'Forbidden',
      message: 'Request blocked by AI Safety Firewall (Policy Violation)',
      code: 'ERR_AI_SAFETY_VIOLATION'
    });
    return;
  }

  logger.info('AI Safety Firewall validation passed', { traceId });
  next();
};
