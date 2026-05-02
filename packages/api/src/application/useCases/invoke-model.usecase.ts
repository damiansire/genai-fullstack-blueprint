import { createHash } from 'node:crypto';
import { ModelFactory } from '../../infrastructure/ai/factory.js';
import { CPUWorkerService } from '../../infrastructure/workers/workerPool.js';
import { ProcessContext } from '../../domain/ai/strategy.interface.js';
import { ApiError } from '../../core/ApiError.js';
import { getCachedResponse, setCachedResponse } from '../../infrastructure/database/db.js';
import { logger } from '../../core/logger.js';
import { getContext, createChildContext } from '../../core/async-context.js';
import { ToolSearchUseCase } from './tool-search.usecase.js';
import { semanticCache } from '../../infrastructure/semantic-cache.service.js';

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

import { UseCase } from '../../core/UseCase.js';

export class InvokeModelUseCase extends UseCase<InvokeModelDTO, any> {
  constructor(private readonly modelFactory: ModelFactory) {
    super();
  }

  protected async executeImpl(dto: InvokeModelDTO): Promise<any> {
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

    // Generate Hash for Caching (exact-match — Tier 2)
    const hashPayload = JSON.stringify({ modelId: dto.modelId, body: requestData });
    const hash = createHash('sha256').update(hashPayload).digest('hex');

    // ───────────────────────────────────────────────────
    // Patrón 3: Tier 1 — Semantic Cache (int8 quantized KNN via sqlite-vec)
    // Runs BEFORE the exact-match check: catches paraphrased duplicates,
    // variations in phrasing, or near-identical prompts that differ in whitespace.
    // Embedding is generated here and reused at store time (no double inference).
    // Silently degrades to MISS when sqlite-vec is not loaded.
    // ───────────────────────────────────────────────────
    const promptText = requestData.messages
      ?.map((m: any) => (typeof m.content === 'string' ? m.content : ''))
      .join(' ') ?? JSON.stringify(requestData);

    const semanticResult = await semanticCache.lookup(promptText, dto.modelId);

    if (semanticResult.hit) {
      // Unredact PII before returning semantic hit
      if (typeof semanticResult.response?.text === 'string') {
        semanticResult.response.text = piiService.unredact(semanticResult.response.text, piiMapping);
      }
      return semanticResult.response;
    }

    // Keep the embedding + hash from the MISS for storage after the LLM call
    const { embedding: missEmbedding, promptHash } = semanticResult;

    // ───────────────────────────────────────────────────
    // Tier 2 — Exact-match SHA-256 cache (existing)
    // ───────────────────────────────────────────────────
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
        // ───────────────────────────────────────────────────
        // Patrón 1: Tool Search JIT (materialised)
        // The LLM emits tool_use: { name: 'search_tools', args: { query } }.
        // We query SQLite for matching schemas and inject them ONLY here —
        // at the end of the context window — so the static System Prompt
        // prefix is never modified, guaranteeing 100% cache hits.
        // ───────────────────────────────────────────────────
        if (toolCall.name === 'search_tools') {
          try {
            const toolSearchUseCase = new ToolSearchUseCase();
            const foundTools = await toolSearchUseCase.execute({
              query: toolCall.args?.query ?? 'general',
              limit: toolCall.args?.limit ?? 5,
            });

            logger.info('[JIT] Tool schemas retrieved and ready for context injection', {
              query: toolCall.args?.query,
              count: foundTools.length,
              names: foundTools.map((t) => t.name),
            });

            return {
              id: toolCall.id,
              result: {
                system_hint: 'Inject these schemas at the END of the context window.',
                injected_schemas: foundTools,
              },
            };
          } catch (e) {
            logger.warn('[JIT] Tool Search failed, falling back to empty result', {
              error: e instanceof Error ? e.message : String(e),
            });
            return { id: toolCall.id, result: { injected_schemas: [] } };
          }
        }

        // Patrón 5: propagate agentic tree context into the worker.
        // The worker can call createChildContext(toolName, parentCtx) to branch
        // the span tree without any function-signature changes.
        const currentContext = getContext();
        const childContext = currentContext
          ? createChildContext(toolCall.name, currentContext)
          : undefined;

        const result = await CPUWorkerService.executeTool(
          toolCall.name,
          toolCall.args,
          childContext
        );
        
        // If the result is a huge JSON string, simulate transferring ownership to a Worker for zero-copy parsing
        if (typeof result === 'string' && result.length > 10000 && result.startsWith('{')) {
           const encoder = new TextEncoder();
           const buffer = encoder.encode(result).buffer as ArrayBuffer;
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
      // Tier 2: exact-match cache
      setCachedResponse(hash, currentResponse);
      // Patrón 3: Tier 1 — also store in semantic cache (reuses embedding from MISS)
      // Fire-and-forget: non-critical, so we don't await or catch here.
      semanticCache.store(missEmbedding, promptHash, currentResponse, dto.modelId);
    }

    // Unredact before returning to user
    if (currentResponse && typeof currentResponse.text === 'string' && Object.keys(piiMapping).length > 0) {
      currentResponse.text = piiService.unredact(currentResponse.text, piiMapping);
    }

    return currentResponse;
  }
}
