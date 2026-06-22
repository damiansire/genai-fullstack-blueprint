import { performance } from 'node:perf_hooks';
import { getTraceId } from './async-context.js';
import { logger } from './logger.js';

/**
 * Base UseCase class implementing the Template Method Pattern.
 * This ensures that all use cases follow a strict execution lifecycle:
 * 1. Pre-execution hook (logging, tracing)
 * 2. Core business logic execution (implemented by subclasses)
 * 3. Post-execution hook (performance metrics)
 * 4. Standardized error handling
 */
export abstract class UseCase<IRequest, IResponse> {
  /**
   * Template Method that orchestrates the execution flow.
   * Subclasses should NOT override this method.
   */
  public async execute(request?: IRequest): Promise<IResponse> {
    const traceId = getTraceId() || 'unknown';
    const useCaseName = this.constructor.name;
    const start = performance.now();

    try {
      if (process.env['NODE_ENV'] === 'development') {
        logger.info(`🎬 Starting ${useCaseName}...`, { traceId });
      }

      // Delegate the actual business logic to the subclass
      const result = await this.executeImpl(request);

      const duration = Math.round(performance.now() - start);
      if (process.env['NODE_ENV'] === 'development') {
        logger.info(`✅ ${useCaseName} completed in ${duration}ms`, { traceId, duration });
      }

      return result;
    } catch (error) {
      const duration = Math.round(performance.now() - start);
      logger.error(
        `❌ ${useCaseName} failed after ${duration}ms`,
        { traceId, duration },
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error; // Re-throw to be handled by the Express global error handler
    }
  }

  /**
   * Abstract method representing the core logic.
   * Must be implemented by concrete subclasses.
   */
  protected abstract executeImpl(request?: IRequest): Promise<IResponse>;
}
