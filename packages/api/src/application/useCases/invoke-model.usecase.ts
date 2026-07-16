import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ModelFactory } from '../../infrastructure/ai/factory.js';
import { CPUWorkerService } from '../../infrastructure/workers/workerPool.js';
import { ProcessContext } from '../../domain/ai/strategy.interface.js';
import { ApiError } from '../../core/ApiError.js';
import { getCachedResponse, setCachedResponse } from '../../infrastructure/database/db.js';
import { logger } from '../../core/logger.js';
import { getContext, createChildContext } from '../../core/async-context.js';
import { ToolSearchUseCase } from './tool-search.usecase.js';
import { semanticCache } from '../../infrastructure/semantic-cache.service.js';
import { CircuitBreaker } from '../../core/circuit-breaker.js';

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

/**
 * Deterministic JSON stringify: object keys are emitted in sorted order at every
 * level so the cache key is invariant to key ordering. Arrays keep their order.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (val as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return val;
  });
}

/**
 * Boundary schema for the invoke body (AGENTS.md: "Validate all boundary input
 * with zod"). It is deliberately permissive — `.passthrough()` keeps the
 * arbitrary model params (temperature, prompt, …) that each strategy consumes —
 * but it pins down the two structural fields the use case actually reasons about:
 *
 *   - `messages`: when present, MUST be an array of `{ role, … }` objects, since
 *     the PII redaction, prompt extraction and agentic loop all iterate it.
 *   - `stream`: when present, MUST be a boolean (it gates whether we cache).
 *
 * A malformed `messages` (e.g. a string, or items without a role) would
 * otherwise blow up deep inside the loop with an opaque error; here it fails
 * fast at the boundary with a 400.
 */
const invokeMessageSchema = z
  .object({
    role: z.string(),
    content: z.unknown().optional(),
  })
  .passthrough();

export const invokeBodySchema = z
  .object({
    messages: z.array(invokeMessageSchema).optional(),
    stream: z.boolean().optional(),
  })
  .passthrough();

/**
 * Max number of messages retained in the agentic loop. Each iteration appends an
 * `assistant` (tool_calls) + a `tool` (results) message, so an unbounded loop
 * grows the context quadratically (each turn re-sends the whole history). We keep
 * a sliding window of the most recent turns and always preserve a leading
 * `system` message (the static prompt prefix) so behaviour/anchoring is stable.
 */
export const AGENTIC_CONTEXT_WINDOW = 12;

/**
 * Trim `messages` to the last `windowSize` entries, always preserving a leading
 * `system` message if one exists. Pure + exported for unit testing.
 */
export function applySlidingWindow<T extends { role?: unknown }>(
  messages: T[],
  windowSize: number = AGENTIC_CONTEXT_WINDOW,
): T[] {
  if (messages.length <= windowSize) return messages;

  const head = messages[0];
  const hasSystemHead = head !== undefined && head.role === 'system';

  if (hasSystemHead) {
    const tail = messages.slice(messages.length - (windowSize - 1));
    return [head, ...tail];
  }
  return messages.slice(messages.length - windowSize);
}

/**
 * Ordered fallback chain tried when a provider's circuit breaker is OPEN.
 * Configurable via `FALLBACK_MODEL_CHAIN` (comma-separated modelIds, highest
 * priority first) so a deployment can choose its own degrade path without a
 * code change; defaults to the second real cloud provider
 * (`openai-gpt-4o-mini`, see `plugins/openai-chat`) and then the local SLM.
 * Only entries actually registered in the `ModelFactory` are tried — an
 * unconfigured/unregistered fallback is skipped, not a hard failure, so this
 * degrades gracefully whether or not a given provider's credentials exist in
 * the environment (AGENTS.md: "Assume external LLM APIs fail").
 */
const DEFAULT_FALLBACK_CHAIN = ['openai-gpt-4o-mini', 'llama-3.1-8b'];

export function getFallbackChain(): string[] {
  const configured = process.env['FALLBACK_MODEL_CHAIN'];
  if (!configured) return DEFAULT_FALLBACK_CHAIN;
  return configured
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

export class InvokeModelUseCase extends UseCase<InvokeModelDTO, any> {
  private static breakers: Map<string, CircuitBreaker> = new Map();

  constructor(private readonly modelFactory: ModelFactory) {
    super();
  }

  private async processWithFallback(
    strategy: any,
    modelId: string,
    requestData: any,
    context: ProcessContext,
  ): Promise<any> {
    if (!InvokeModelUseCase.breakers.has(modelId)) {
      InvokeModelUseCase.breakers.set(
        modelId,
        new CircuitBreaker(modelId, {
          failureThreshold: 3,
          resetTimeoutMs: 30000,
          requestTimeoutMs: 15000,
        }),
      );
    }
    const breaker = InvokeModelUseCase.breakers.get(modelId)!;

    try {
      return await breaker.fire(() => strategy.process(requestData, context));
    } catch (error) {
      if (breaker.getState() !== 'OPEN') {
        throw error;
      }

      const fallbackId = getFallbackChain().find(
        (candidateId) => candidateId !== modelId && this.modelFactory.isRegistered(candidateId),
      );

      if (!fallbackId) {
        throw error;
      }

      logger.warn(`Model ${modelId} circuit is OPEN, falling back to ${fallbackId}`);
      const fallbackStrategy = this.modelFactory.create(fallbackId);
      const fallbackReq = { ...requestData };
      fallbackReq.messages = [
        ...(fallbackReq.messages || []),
        {
          role: 'system',
          content: `[SYSTEM_FALLBACK]: Degradación Elegante Activa (${fallbackId}). El modelo primario está fallando.`,
        },
      ];
      return await fallbackStrategy.process(fallbackReq, context);
    }
  }

  protected async executeImpl(dto: InvokeModelDTO): Promise<any> {
    if (!dto.modelId) {
      throw ApiError.badRequest('Model ID is required');
    }

    if (!this.modelFactory.isRegistered(dto.modelId)) {
      throw ApiError.notFound(`Model '${dto.modelId}' is not available`);
    }

    // Boundary validation (zod): fail fast on a malformed body instead of
    // crashing deep inside PII redaction / the agentic loop with an opaque error.
    const parsedBody = invokeBodySchema.safeParse(dto.body ?? {});
    if (!parsedBody.success) {
      throw ApiError.badRequest(
        `Invalid invoke body: ${parsedBody.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`,
      );
    }

    const strategy = this.modelFactory.create(dto.modelId);

    const requestData: any = {
      ...parsedBody.data,
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
    const piiMapping: Record<string, string> = {};
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
        logger.info('PII Redaction applied before external API call', {
          tokens: Object.keys(piiMapping).length,
        });
      }
    }

    // Generate Hash for Caching (exact-match — Tier 2).
    // Canonicalize with a key-sorted replacer so that semantically identical
    // payloads with different key orders hash to the SAME value (no cache misses
    // caused purely by JSON key ordering).
    const hashPayload = stableStringify({ modelId: dto.modelId, body: requestData });
    const hash = createHash('sha256').update(hashPayload).digest('hex');

    // ───────────────────────────────────────────────────
    // Patrón 3: Tier 1 — Semantic Cache (int8 quantized KNN via sqlite-vec)
    // Runs BEFORE the exact-match check: catches paraphrased duplicates,
    // variations in phrasing, or near-identical prompts that differ in whitespace.
    // Embedding is generated here and reused at store time (no double inference).
    // Silently degrades to MISS when sqlite-vec is not loaded.
    // ───────────────────────────────────────────────────
    const promptText =
      requestData.messages
        ?.map((m: any) => (typeof m.content === 'string' ? m.content : ''))
        .join(' ') ?? JSON.stringify(requestData);

    const semanticResult = await semanticCache.lookup(promptText, dto.modelId);

    if (semanticResult.hit) {
      // Unredact PII before returning semantic hit
      if (typeof semanticResult.response?.text === 'string') {
        semanticResult.response.text = piiService.unredact(
          semanticResult.response.text,
          piiMapping,
        );
      }
      // Mark cache hits so downstream metrics/observability can distinguish a
      // HIT from a real model call (cost/latency attribution).
      if (semanticResult.response && typeof semanticResult.response === 'object') {
        semanticResult.response.cached = true;
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
      if (typeof cachedResponse === 'object') {
        cachedResponse.cached = true;
      }
      return cachedResponse;
    }

    // Agentic Loop
    let currentResponse = await this.processWithFallback(
      strategy,
      dto.modelId,
      requestData,
      dto.context,
    );
    const maxIterations = 5;
    let iterations = 0;

    while (currentResponse && currentResponse.tool_calls && iterations < maxIterations) {
      iterations++;
      logger.info(`Agentic Loop Iteration ${iterations}: Executing tools`, {
        tools: currentResponse.tool_calls,
      });

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
          childContext,
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

      // Sliding window: each iteration adds 2 messages and the whole history is
      // re-sent every turn, so cap it to avoid quadratic context growth.
      requestData.messages = applySlidingWindow(requestData.messages);

      // Call AI again
      currentResponse = await this.processWithFallback(
        strategy,
        dto.modelId,
        requestData,
        dto.context,
      );
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
    if (
      currentResponse &&
      typeof currentResponse.text === 'string' &&
      Object.keys(piiMapping).length > 0
    ) {
      currentResponse.text = piiService.unredact(currentResponse.text, piiMapping);
    }

    return currentResponse;
  }
}
