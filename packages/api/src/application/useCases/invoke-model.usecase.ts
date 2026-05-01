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

    const { piiService } = await import('../../services/piiService.js');

    // 1. PII Redaction Phase (Edge Routing & Validation)
    // "identifica de manera estocástica todas las entidades sensibles... reemplazando criptográficamente nombres e importes"
    let piiMapping: Record<string, string> = {};
    if (requestData.messages) {
      requestData.messages = requestData.messages.map((msg: any) => {
        if (typeof msg.content === 'string') {
          const { redactedText, mapping } = piiService.redact(msg.content);
          Object.assign(piiMapping, mapping);
          return { ...msg, content: redactedText };
        }
        return msg;
      });
      if (Object.keys(piiMapping).length > 0) {
        logger.info('PII Redaction applied before external API call', { tokens: Object.keys(piiMapping).length });
      }
    }

    // Generate Hash for Caching
    const hashPayload = JSON.stringify({ modelId: dto.modelId, body: requestData });
    const hash = createHash('sha256').update(hashPayload).digest('hex');

    // Check Cache
    const cachedResponse = getCachedResponse(hash);
    if (cachedResponse) {
      logger.info(`Cache HIT for model ${dto.modelId}`, { hash });
      // Unredact before returning from cache
      if (typeof cachedResponse.text === 'string') {
         cachedResponse.text = piiService.unredact(cachedResponse.text, piiMapping);
      }
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
        // Advanced Dynamic Tool Search (Interception)
        if (toolCall.name === 'search_tools') {
          try {
            const { embeddingService } = await import('../../services/embeddingService.js');
            const queryVector = await embeddingService.generateEmbedding(toolCall.args.query || 'general');
            
            // In a real system, you'd match the queryVector against tool definitions stored in sqlite-vec.
            // We simulate the DB search and "Just in Time" recovery:
            logger.info('Dynamic Tool Search intercepted', { query: toolCall.args.query });
            
            return { 
              id: toolCall.id, 
              result: { 
                system_message: 'Tool definitions retrieved and injected at the end of context to protect prompt cache.',
                injected_schemas: [{ name: 'found_tool', description: 'Dynamically retrieved tool' }]
              } 
            };
          } catch (e) {
             logger.warn('Dynamic Tool Search failed, falling back', {}, e as Error);
          }
        }

        const result = await CPUWorkerService.executeTool(toolCall.name, toolCall.args);
        
        // If the result is a huge JSON string, simulate transferring ownership to a Worker for zero-copy parsing
        if (typeof result === 'string' && result.length > 10000 && result.startsWith('{')) {
           const encoder = new TextEncoder();
           const buffer = encoder.encode(result).buffer; // ArrayBuffer
           const parsedResult = await CPUWorkerService.parseJsonZeroCopy(buffer, 'ToolResultSchema');
           return { id: toolCall.id, result: parsedResult };
        }

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

    // Unredact before returning to user
    if (currentResponse && typeof currentResponse.text === 'string' && Object.keys(piiMapping).length > 0) {
      currentResponse.text = piiService.unredact(currentResponse.text, piiMapping);
    }

    return currentResponse;
  }
}
