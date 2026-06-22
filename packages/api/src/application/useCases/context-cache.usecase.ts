import { UseCase } from '../../core/UseCase.js';
import { getContext } from '../../core/async-context.js';
import { logger } from '../../core/logger.js';
import { saveContextCache, getContextCache } from '../../infrastructure/database/db.js';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export interface ContextCacheDTO {
  action: 'create' | 'get';
  fileName?: string | undefined;
  mimeType?: string | undefined;
  sizeBytes?: number | undefined;
  cacheId?: string | undefined;
}

export interface ContextCacheResult {
  cacheId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  action: 'create' | 'get';
  processingMs: number;
}

export class ContextCacheUseCase extends UseCase<ContextCacheDTO, ContextCacheResult> {
  protected async executeImpl(request: ContextCacheDTO): Promise<ContextCacheResult> {
    const { action } = request;
    const start = performance.now();
    const traceId = getContext()?.traceId;

    logger.info(`[ContextCache] Starting ${action} action`, { traceId });

    if (action === 'create') {
      const {
        fileName = 'unknown',
        mimeType = 'application/octet-stream',
        sizeBytes = 0,
      } = request;
      const cacheId = `gemini-cache-${randomUUID()}`;

      // Simulate Gemini API upload delay
      await new Promise((resolve) => setTimeout(resolve, 300));

      saveContextCache(cacheId, fileName, mimeType, sizeBytes);

      logger.info(`[ContextCache] Created cache entry: ${cacheId}`, { traceId });

      return {
        cacheId,
        fileName,
        mimeType,
        sizeBytes,
        createdAt: new Date().toISOString(),
        action: 'create',
        processingMs: Math.round(performance.now() - start),
      };
    } else if (action === 'get') {
      const { cacheId } = request;
      if (!cacheId) throw new Error('cacheId is required for get action');

      const cache = getContextCache(cacheId);
      if (!cache) throw new Error(`Cache ID ${cacheId} not found`);

      return {
        ...cache,
        cacheId: cache.id,
        action: 'get',
        processingMs: Math.round(performance.now() - start),
      };
    }

    throw new Error(`Unsupported action: ${action}`);
  }
}

export const contextCacheUseCase = new ContextCacheUseCase();
