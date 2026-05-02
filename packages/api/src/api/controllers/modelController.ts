import { Request, Response, NextFunction } from 'express';
import { performance } from 'node:perf_hooks';
import { ModelFactory } from '../../infrastructure/ai/factory.js';
import { ProcessContext, ModelMetadata } from '../../domain/ai/strategy.interface.js';
import { ApiResponse } from '../../core/types.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../../core/logger.js';

import { InvokeModelUseCase, InvokeModelDTO } from '../../application/useCases/invoke-model.usecase.js';
import { GetModelInfoUseCase, GetModelInfoDTO } from '../../application/useCases/get-model-info.usecase.js';
import { ListModelsUseCase } from '../../application/useCases/list-models.usecase.js';

/**
 * Create the model controller with ModelFactory dependency
 * @param modelFactory - Instance of ModelFactory
 * @returns Express controller function
 */
export function createModelController(modelFactory: ModelFactory) {
  const invokeModelUseCase = new InvokeModelUseCase(modelFactory);

  return asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const startTime = performance.now();
    const modelId = req.params['modelId'] || '';
    
    try {
      // 1. Prepare DTO (Map HTTP Request to Use Case DTO)
      const context: ProcessContext = {
        apiKey: req.user?.apiKeyId,
        userId: req.user?.apiKeyId // Using API key ID as user identifier
      };

      const dto: InvokeModelDTO = {
        modelId,
        body: req.body,
        context
      };

      if (req.file) {
        dto.file = {
          fieldname: req.file.fieldname,
          originalname: req.file.originalname,
          encoding: req.file.encoding,
          mimetype: req.file.mimetype,
          size: req.file.size,
          buffer: req.file.buffer,
          path: req.file.path
        };
      }

      if (req.files) {
        if (Array.isArray(req.files)) {
          dto.files = req.files.map(file => ({
            fieldname: file.fieldname,
            originalname: file.originalname,
            encoding: file.encoding,
            mimetype: file.mimetype,
            size: file.size,
            buffer: file.buffer,
            path: file.path
          }));
        } else {
          dto.files = Object.keys(req.files).reduce((acc, fieldname) => {
            const files = (req.files as any)[fieldname];
            acc[fieldname] = Array.isArray(files) ? files : [files];
            return acc;
          }, {} as any);
        }
      }

      // Log model invocation intent
      logger.info(`Controller: Dispatching Use Case for '${modelId}'`, {
        hasFile: !!req.file,
        hasFiles: !!req.files,
        bodyKeys: Object.keys(req.body),
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });

      // 2. Execute Use Case
      const result = await invokeModelUseCase.execute(dto);

      // 3. Format HTTP Response
      const processingTime = Math.round(performance.now() - startTime);
      
      const response: ApiResponse<any, ModelMetadata> = {
        success: true,
        data: result,
        metadata: {
          ...result.metadata,
          modelId,
          processingTime,
          timestamp: new Date().toISOString()
        }
      };

      // Handle token rate limiting consumption
      const store = res.locals['tokenStore'];
      const totalTokens = result.metadata?.usageMetadata?.totalTokenCount || 0;
      
      if (store && totalTokens > 0) {
        const identifier = res.locals['rateLimitIdentifier'];
        const windowMs = res.locals['rateLimitWindowMs'];
        
        try {
          await store.consume(identifier, totalTokens, windowMs);
          logger.info(`Consumed ${totalTokens} tokens for ${identifier}`);
        } catch (err) {
          logger.error('Failed to consume tokens in store', {}, err instanceof Error ? err : new Error(String(err)));
        }
      }

      logger.info(`Controller: Use Case '${modelId}' completed successfully`, {
        processingTime: `${processingTime}ms`
      });

      res.status(200).json(response);

    } catch (error) {
      const processingTime = Math.round(performance.now() - startTime);
      logger.error(`Controller: Use Case '${modelId}' failed`, {
        processingTime: `${processingTime}ms`
      }, error);
      // Re-throw the error to be handled by the global error middleware
      throw error;
    }
  });
}

/**
 * Controller for getting model information
 * @param modelFactory - Instance of ModelFactory
 * @returns Express controller function
 */
export function createModelInfoController(modelFactory: ModelFactory) {
  const getModelInfoUseCase = new GetModelInfoUseCase(modelFactory);

  return asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    // 1. Prepare DTO
    const dto: GetModelInfoDTO = {
      modelId: req.params['modelId'] || ''
    };

    // 2. Execute Use Case
    const modelInfo = await getModelInfoUseCase.execute(dto);

    // 3. Send Response
    res.json({
      success: true,
      data: modelInfo
    });
  });
}

/**
 * Controller for listing all available models
 * @param modelFactory - Instance of ModelFactory
 * @returns Express controller function
 */
export function createModelListController(modelFactory: ModelFactory) {
  const listModelsUseCase = new ListModelsUseCase(modelFactory);

  return asyncHandler(async (_req: Request, res: Response, _next: NextFunction) => {
    // 1. Execute Use Case (no DTO needed)
    const result = await listModelsUseCase.execute();

    // 2. Send Response
    res.json({
      success: true,
      data: result
    });
  });
}

/**
 * Controller for streaming model responses using Server-Sent Events (SSE) and native streams
 * @param modelFactory - Instance of ModelFactory
 * @returns Express controller function
 */
export function createStreamController(modelFactory: ModelFactory) {
  const invokeModelUseCase = new InvokeModelUseCase(modelFactory);

  return asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const modelId = req.params['modelId'] || '';
    
    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Flush headers immediately
    res.flushHeaders();

    try {
      // In a real implementation, the UseCase would return a Readable stream
      // or an AsyncGenerator. For this scaffold, we simulate a stream from a UseCase result.
      const dto: InvokeModelDTO = {
        modelId,
        body: req.body,
        context: {
          apiKey: req.user?.apiKeyId,
          userId: req.user?.apiKeyId
        }
      };

      const result = await invokeModelUseCase.execute(dto);
      
      // Simulate chunking the response text using a native interval (streaming behavior)
      // Since our current models return a complete response, we mock the stream by breaking it.
      const textToStream = result.text || JSON.stringify(result);
      const chunkSize = 10;
      let i = 0;

      const intervalId = setInterval(async () => {
        if (i < textToStream.length) {
          const chunk = textToStream.slice(i, i + chunkSize);
          res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
          i += chunkSize;
        } else {
          clearInterval(intervalId);
          res.write('event: done\n');
          res.write('data: {}\n\n');
          res.end();
          
          // Consume tokens for streaming request
          const store = res.locals['tokenStore'];
          const totalTokens = result.metadata?.usageMetadata?.totalTokenCount || 0;
          
          if (store && totalTokens > 0) {
            const identifier = res.locals['rateLimitIdentifier'];
            const windowMs = res.locals['rateLimitWindowMs'];
            try {
              await store.consume(identifier, totalTokens, windowMs);
              logger.info(`[Stream] Consumed ${totalTokens} tokens for ${identifier}`);
            } catch (err) {
              logger.error('[Stream] Failed to consume tokens', {}, err instanceof Error ? err : new Error(String(err)));
            }
          }
        }
      }, 50);

      // Handle client disconnect
      req.on('close', () => {
        clearInterval(intervalId);
        logger.info(`Client disconnected during stream from '${modelId}'`);
      });

    } catch (error) {
      logger.error(`Stream Controller: Use Case '${modelId}' failed`, {}, error);
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ message: 'Stream failed' })}\n\n`);
      res.end();
    }
  });
}
