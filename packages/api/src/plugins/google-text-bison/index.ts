import { IModelStrategy, ProcessContext, ModelOutput } from '../../domain/ai/strategy.interface.js';
import { performance } from 'node:perf_hooks';

import { logger } from '../../core/logger.js';

/**
 * Model ID for Google Text Bison
 */
export const modelId = 'google-text-bison';

/**
 * JSON Schema for Google Text Bison configuration
 * Defines the required input structure for the model
 */
export const configSchema = {
  type: 'object',
  properties: {
    prompt: {
      type: 'string',
      description: 'The text prompt to send to the model',
      minLength: 1,
      maxLength: 8192
    },
    maxTokens: {
      type: 'number',
      description: 'Maximum number of tokens to generate',
      minimum: 1,
      maximum: 1024,
      default: 256
    },
    temperature: {
      type: 'number',
      description: 'Controls randomness in the output',
      minimum: 0.0,
      maximum: 1.0,
      default: 0.7
    },
    topP: {
      type: 'number',
      description: 'Controls diversity of the output',
      minimum: 0.0,
      maximum: 1.0,
      default: 0.9
    },
    topK: {
      type: 'number',
      description: 'Controls the number of top tokens to consider',
      minimum: 1,
      maximum: 100,
      default: 40
    },
    stopSequences: {
      type: 'array',
      description: 'Sequences where the model should stop generating',
      items: {
        type: 'string'
      },
      maxItems: 5
    }
  },
  required: ['prompt'],
  additionalProperties: true
};

/**
 * Input interface for Google Text Bison
 */
interface GoogleTextBisonInput {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
}

/**
 * Output interface for Google Text Bison
 */
interface GoogleTextBisonOutput {
  text: string;
  finishReason: 'STOP' | 'MAX_TOKENS' | 'SAFETY';
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Google Text Bison Model Strategy Implementation
 * Simulates calls to Google's Text Bison API
 */
export class ModelStrategy implements IModelStrategy<GoogleTextBisonInput, ModelOutput<GoogleTextBisonOutput>> {
  private readonly modelName = 'text-bison-001';
  private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';

  /**
   * Process a text generation request
   * @param params - Input parameters for text generation
   * @param context - Processing context with API key and user info
   * @returns Promise resolving to the generated text response
   */
  async process(
    params: GoogleTextBisonInput, 
    context: ProcessContext
  ): Promise<ModelOutput<GoogleTextBisonOutput>> {
    const startTime = performance.now();

    try {
      // Validate required parameters
      if (!params.prompt || typeof params.prompt !== 'string') {
        throw new Error('Prompt is required and must be a string');
      }

      // Validate API key
      if (!context.apiKey) {
        throw new Error('API key is required for Google Text Bison');
      }

      // Prepare request parameters with defaults
      const requestParams = {
        prompt: params.prompt,
        maxTokens: params.maxTokens || 256,
        temperature: params.temperature || 0.7,
        topP: params.topP || 0.9,
        topK: params.topK || 40,
        stopSequences: params.stopSequences || []
      };

      // Log the request
      logger.info('Processing Google Text Bison request', {
        promptLength: params.prompt.length,
        maxTokens: requestParams.maxTokens,
        temperature: requestParams.temperature,
        userId: context.userId
      });

      // Llamada REAL a la API usando Node.js fetch
      const response = await this.executeApiCall(requestParams, context.apiKey);

      const processingTime = Math.round(performance.now() - startTime);

      // Log successful response
      logger.info('Google Text Bison request completed', {
        responseLength: response.text.length,
        processingTime: `${processingTime}ms`,
        finishReason: response.finishReason,
        totalTokens: response.usage.totalTokens
      });

      return {
        result: response,
        metadata: {
          processingTime,
          modelVersion: this.modelName,
          apiProvider: 'Google',
          timestamp: new Date().toISOString(),
          usageMetadata: {
            promptTokenCount: response.usage.promptTokens,
            candidatesTokenCount: response.usage.completionTokens,
            totalTokenCount: response.usage.totalTokens
          }
        }
      };

    } catch (error) {
      const processingTime = Math.round(performance.now() - startTime);
      
      logger.error('Google Text Bison request failed', {
        processingTime: `${processingTime}ms`
      }, error);

      throw error;
    }
  }

  /**
   * Ejecuta la llamada real a la API de Google Text Bison (PaLM/Gemini)
   * Usando el cliente Fetch nativo de Node.js v18+
   */
  private async executeApiCall(
    params: GoogleTextBisonInput, 
    apiKey: string
  ): Promise<GoogleTextBisonOutput> {
    const url = `${this.baseUrl}/${this.modelName}:generateText?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: { text: params.prompt },
        temperature: params.temperature,
        topK: params.topK,
        topP: params.topP,
        candidateCount: 1,
        maxOutputTokens: params.maxTokens,
        stopSequences: params.stopSequences && params.stopSequences.length > 0 ? params.stopSequences : undefined
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Google API Error: ${response.status} - ${errorData}`);
    }

    const data = await response.json() as any;
    const candidate = data.candidates?.[0];
    
    if (!candidate) {
      throw new Error('La API de Google no devolvió ningún candidato válido.');
    }

    return {
      text: candidate.output,
      finishReason: 'STOP',
      usage: {
        promptTokens: 0, // PaLM API no siempre devuelve usage info preciso
        completionTokens: 0,
        totalTokens: 0
      }
    };
  }

  /**
   * Get model information
   * @returns Model metadata
   */
  getModelInfo() {
    return {
      modelId,
      modelName: this.modelName,
      provider: 'Google',
      type: 'text-generation',
      capabilities: ['text-generation', 'completion', 'conversation'],
      maxTokens: 1024,
      supportsStreaming: false
    };
  }
}