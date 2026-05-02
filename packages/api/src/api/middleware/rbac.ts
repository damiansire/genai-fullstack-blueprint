import { Request, Response, NextFunction } from 'express';
import { logger } from '../../core/logger.js';

// Define which models require which tier. 
// A 'premium' tier can access 'free' models, but 'free' cannot access 'premium' models.
const MODEL_TIERS: Record<string, 'free' | 'premium'> = {
  'gemini-1.5-flash': 'free',
  'gemini-1.5-pro': 'premium',
  'google-text-bison': 'free',
  'google-vision-ocr': 'free',
  'gemini-image-gen': 'premium'
};

const TIER_LEVELS = {
  'free': 0,
  'premium': 1
};

export const rbacModelMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const modelId = req.params['modelId'];
  if (!modelId) return next();

  const requiredTier = MODEL_TIERS[modelId] || 'free'; // default to free
  const userTier = (req.user as any)?.tier || 'free'; // Assume req.user has a tier property

  const requiredLevel = TIER_LEVELS[requiredTier as keyof typeof TIER_LEVELS] ?? 0;
  const userLevel = TIER_LEVELS[userTier as keyof typeof TIER_LEVELS] ?? 0;

  if (userLevel < requiredLevel) {
    logger.warn(`RBAC: User ${req.user?.apiKeyId || 'unknown'} attempted to access premium model ${modelId} with tier ${userTier}`);
    res.status(403).json({
      success: false,
      error: 'Forbidden',
      message: `Access to model '${modelId}' requires '${requiredTier}' tier. Your current tier is '${userTier}'.`
    });
    return;
  }

  next();
};
