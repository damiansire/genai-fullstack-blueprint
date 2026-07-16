import { IModelStrategy, ProcessContext, ModelOutput } from '../../domain/ai/strategy.interface.js';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';

import { logger } from '../../core/logger.js';
import { resilientTransport } from '../../infrastructure/http/resilient-transport.js';

/**
 * Second real LLM provider adapter (OpenAI Chat Completions), added so the
 * "AI Gateway" name is honest: a gateway that only ever calls Gemini isn't
 * one. This plugin implements the SAME `IModelStrategy` port every other
 * provider uses (see `domain/ai/strategy.interface.ts`) — that port IS the
 * provider abstraction, there is no separate "LLMProvider" interface to keep
 * in sync. It mirrors `google-text-bison`'s output shape
 * (`{ text, finishReason, usage }`) so `InvokeModelUseCase.processWithFallback`
 * (see `application/useCases/invoke-model.usecase.ts`) can fall back into it
 * transparently when the primary provider's circuit breaker opens.
 *
 * Verification status (documented explicitly per AGENTS.md "framing honesto de
 * límites"): this adapter is implemented and unit-tested against a MOCKED
 * `fetch` (see `index.test.ts`), exercising request shaping, response
 * parsing and error handling. End-to-end verification against the REAL
 * OpenAI API is PENDING — no `OPENAI_API_KEY` was available in this
 * environment at implementation time. `process()` fails fast (never sends a
 * placeholder key) when the key is missing, same posture as the Gemini
 * plugins.
 */

/**
 * Boundary schema for the OpenAI `chat/completions` response. Only the
 * fields we actually read are pinned; everything else is passthrough so the
 * provider can add fields without breaking us (same pattern as the Gemini
 * plugins' response schemas).
 */
const openaiChoiceSchema = z
  .object({
    message: z
      .object({
        role: z.string().optional(),
        content: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
    finish_reason: z.string().optional(),
  })
  .passthrough();

const openaiChatResponseSchema = z
  .object({
    choices: z.array(openaiChoiceSchema).optional(),
    usage: z
      .object({
        prompt_tokens: z.number().optional(),
        completion_tokens: z.number().optional(),
        total_tokens: z.number().optional(),
      })
      .passthrough()
      .optional(),
    error: z
      .object({
        message: z.string().optional(),
        type: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

type OpenAIChatResponse = z.infer<typeof openaiChatResponseSchema>;

/**
 * Model ID for registration. Also the value used as a fallback target from
 * `InvokeModelUseCase.processWithFallback` (see `FALLBACK_MODEL_CHAIN`).
 */
export const modelId = 'openai-gpt-4o-mini';

/**
 * JSON Schema for input validation (same request shape as
 * `google-text-bison`: single `prompt`, not a raw `messages[]` array, so the
 * two providers are interchangeable from the use case's point of view).
 */
export const configSchema = {
  type: 'object',
  properties: {
    prompt: {
      type: 'string',
      description: 'The text prompt to send to the model',
      minLength: 1,
      maxLength: 8192,
    },
    maxTokens: {
      type: 'number',
      description: 'Maximum number of tokens to generate',
      minimum: 1,
      maximum: 4096,
      default: 256,
    },
    temperature: {
      type: 'number',
      description: 'Controls randomness in the output',
      minimum: 0.0,
      maximum: 2.0,
      default: 0.7,
    },
  },
  required: ['prompt'],
  additionalProperties: true,
};

interface OpenAIChatInput {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

interface OpenAIChatOutput {
  text: string;
  finishReason: 'STOP' | 'MAX_TOKENS' | 'SAFETY';
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

const FINISH_REASON_MAP: Record<string, OpenAIChatOutput['finishReason']> = {
  stop: 'STOP',
  length: 'MAX_TOKENS',
  content_filter: 'SAFETY',
};

/**
 * OpenAI Chat Completions Strategy — the second real provider behind the
 * `IModelStrategy` port.
 */
export class ModelStrategy implements IModelStrategy<
  OpenAIChatInput,
  ModelOutput<OpenAIChatOutput>
> {
  private readonly modelName = 'gpt-4o-mini';
  private readonly baseUrl = 'https://api.openai.com/v1/chat/completions';

  constructor() {
    if (!process.env['OPENAI_API_KEY']) {
      logger.warn(
        'OPENAI_API_KEY not found in environment variables. openai-gpt-4o-mini calls will fail fast until it is set.',
      );
    }
  }

  async process(
    params: OpenAIChatInput,
    _context: ProcessContext,
  ): Promise<ModelOutput<OpenAIChatOutput>> {
    const startTime = performance.now();

    try {
      if (!params.prompt || typeof params.prompt !== 'string') {
        throw new Error('Prompt is required and must be a string');
      }

      // Fail fast: never send a placeholder credential to OpenAI. A missing
      // key is a configuration error, not something to mask behind a 401.
      const apiKey = process.env['OPENAI_API_KEY'];
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY is not configured. Please set it in your .env file.');
      }

      logger.info('Processing OpenAI chat completion request', {
        promptLength: params.prompt.length,
        maxTokens: params.maxTokens ?? 256,
        temperature: params.temperature ?? 0.7,
      });

      const response = await resilientTransport.fetchJson(
        this.baseUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: this.modelName,
            messages: [{ role: 'user', content: params.prompt }],
            max_tokens: params.maxTokens ?? 256,
            temperature: params.temperature ?? 0.7,
          }),
        },
        openaiChatResponseSchema,
      );

      const output = this.extractOutputFromResponse(response);
      const processingTime = Math.round(performance.now() - startTime);

      logger.info('OpenAI chat completion request completed', {
        responseLength: output.text.length,
        processingTime: `${processingTime}ms`,
        finishReason: output.finishReason,
        totalTokens: output.usage.totalTokens,
      });

      return {
        result: output,
        metadata: {
          processingTime,
          modelVersion: this.modelName,
          apiProvider: 'OpenAI',
          timestamp: new Date().toISOString(),
          usageMetadata: {
            promptTokenCount: output.usage.promptTokens,
            candidatesTokenCount: output.usage.completionTokens,
            totalTokenCount: output.usage.totalTokens,
          },
        },
      };
    } catch (error) {
      const processingTime = Math.round(performance.now() - startTime);
      logger.error(
        'OpenAI chat completion request failed',
        { processingTime: `${processingTime}ms` },
        error,
      );
      throw error;
    }
  }

  private extractOutputFromResponse(response: OpenAIChatResponse): OpenAIChatOutput {
    if (response.error) {
      throw new Error(`OpenAI API error: ${response.error.message ?? 'unknown error'}`);
    }

    const choice = response.choices?.[0];
    const content = choice?.message?.content;

    if (!choice || typeof content !== 'string') {
      throw new Error('OpenAI API did not return a valid completion.');
    }

    return {
      text: content,
      finishReason: FINISH_REASON_MAP[choice.finish_reason ?? 'stop'] ?? 'STOP',
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
    };
  }

  getModelInfo() {
    return {
      modelId,
      modelName: this.modelName,
      provider: 'OpenAI',
      type: 'text-generation',
      capabilities: ['text-generation', 'completion', 'conversation'],
      maxTokens: 4096,
      supportsStreaming: false,
    };
  }
}
