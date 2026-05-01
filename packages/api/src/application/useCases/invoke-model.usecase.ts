import { createHash } from 'node:crypto';
import { ModelFactory } from '../../infrastructure/ai/factory.js';
import { CPUWorkerService } from '../../infrastructure/workers/workerPool.js';
import { ProcessContext } from '../../domain/ai/strategy.interface.js';
import { ApiError } from '../../core/ApiError.js';
import { getCachedResponse, setCachedResponse } from '../../infrastructure/database/db.js';
import { logger } from '../../core/logger.js';

export interface InvokeModelDTO {
  modelId: string;
  body: Record<string, any>;
  file?: {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
    path?: string;
  };
  files?: any;
  context: ProcessContext;
}

export class InvokeModelUseCase {
  constructor(private readonly modelFactory: ModelFactory) {}

  public async execute(dto: InvokeModelDTO): Promise<any> {
    if (!dto.modelId) {
      throw ApiError.badRequest('Model ID is required');
    }

    if (!this.modelFactory.isRegistered(dto.modelId)) {
      throw ApiError.notFound(`Model '${dto.modelId}' is not available`);
    }

    const strategy = this.modelFactory.create(dto.modelId);

    const requestData: any = {
      ...dto.body,
    };

    if (dto.file) {
      requestData.file = dto.file;
    }

    if (dto.files) {
      requestData.files = dto.files;
    }

    // Generate Hash for Caching
    const hashPayload = JSON.stringify({ modelId: dto.modelId, body: requestData });
    const hash = createHash('sha256').update(hashPayload).digest('hex');

    // Check Cache
    const cachedResponse = getCachedResponse(hash);
    if (cachedResponse) {
      logger.info(`Cache HIT for model ${dto.modelId}`, { hash });
      return cachedResponse;
    }

    // Agentic Loop
    let currentResponse = await strategy.process(requestData, dto.context);
    const maxIterations = 5;
    let iterations = 0;

    while (currentResponse && currentResponse.tool_calls && iterations < maxIterations) {
      iterations++;
      logger.info(`Agentic Loop Iteration ${iterations}: Executing tools`, { tools: currentResponse.tool_calls });
      
      // Execute tools in parallel using native worker threads
      const toolPromises = currentResponse.tool_calls.map(async (toolCall: any) => {
        const result = await CPUWorkerService.executeTool(toolCall.name, toolCall.args);
        return { id: toolCall.id, result };
      });
      
      const toolResults = await Promise.all(toolPromises);

      // Append tool results to requestData (simulate sending them back to the AI)
      requestData.messages = requestData.messages || [];
      requestData.messages.push({ role: 'assistant', tool_calls: currentResponse.tool_calls });
      requestData.messages.push({ role: 'tool', results: toolResults });

      // Call AI again
      currentResponse = await strategy.process(requestData, dto.context);
    }

    if (iterations >= maxIterations) {
      logger.warn('Agentic loop reached max iterations', { modelId: dto.modelId });
    }

    // Save to Cache (Only caching non-streaming for simplicity in this implementation)
    if (!dto.body['stream'] && !currentResponse.tool_calls) {
      setCachedResponse(hash, currentResponse);
    }

    return currentResponse;
  }
}
