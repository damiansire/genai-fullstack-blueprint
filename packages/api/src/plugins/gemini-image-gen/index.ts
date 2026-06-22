import { IModelStrategy, ProcessContext, ModelOutput } from '../../domain/ai/strategy.interface.js';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { logger } from '../../core/logger.js';
import { resilientTransport } from '../../infrastructure/http/resilient-transport.js';

/**
 * Boundary schema for the Gemini `generateContent` response. Only the structure
 * we read in `extractOutputFromResponse` is pinned (candidates → content.parts
 * with optional `text` / `inlineData`); everything else is passthrough so the
 * provider can add fields without breaking us.
 */
const geminiPartSchema = z
  .object({
    text: z.string().optional(),
    inlineData: z
      .object({ data: z.string(), mimeType: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

const geminiResponseSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            content: z
              .object({ parts: z.array(geminiPartSchema).optional() })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

type GeminiResponse = z.infer<typeof geminiResponseSchema>;

/**
 * Input parameters for Gemini Image Generation
 */
export interface GeminiImageGenInput {
  prompt: string;
  aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';
  responseModalities?: ('Image' | 'Text')[];
  inputImages?: Array<{
    data: string; // base64
    mimeType: string;
  }>;
}

/**
 * Output from Gemini Image Generation
 */
export interface GeminiImageGenOutput {
  images: Array<{
    data: string; // base64
    mimeType: string;
  }>;
  text?: string;
}

/**
 * Model ID for registration
 */
export const modelId = 'gemini-image-gen';

/**
 * JSON Schema for input validation
 */
export const configSchema = {
  type: 'object',
  properties: {
    prompt: {
      type: 'string',
      description: 'Descriptive text prompt for image generation or editing',
      minLength: 1,
      maxLength: 8192,
    },
    aspectRatio: {
      type: 'string',
      description: 'Aspect ratio for generated image',
      enum: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
      default: '1:1',
    },
    responseModalities: {
      type: 'array',
      description: 'Output modalities (Image, Text, or both)',
      items: {
        type: 'string',
        enum: ['Image', 'Text'],
      },
      default: ['Image', 'Text'],
    },
    inputImages: {
      type: 'array',
      description: 'Optional input images for editing or composition',
      items: {
        type: 'object',
        properties: {
          data: { type: 'string', description: 'Base64 encoded image data' },
          mimeType: { type: 'string', description: 'Image MIME type' },
        },
        required: ['data', 'mimeType'],
      },
    },
  },
  required: ['prompt'],
};

/**
 * Gemini 2.5 Flash Image Generation Strategy (Nano Banana)
 * Supports text-to-image and image editing capabilities
 */
export class ModelStrategy implements IModelStrategy<
  GeminiImageGenInput,
  ModelOutput<GeminiImageGenOutput>
> {
  readonly modelName = 'gemini-2.5-flash-image';
  readonly description =
    'Gemini 2.5 Flash Image Generation - Text-to-Image, Image Editing, Style Transfer';

  constructor() {
    const apiKey = process.env['GEMINI_API_KEY'];

    if (!apiKey) {
      logger.warn(
        'GEMINI_API_KEY not found in environment variables. Image generation will fail. Please set GEMINI_API_KEY in your .env file',
      );
    }
  }

  /**
   * Process image generation request
   */
  async process(
    params: GeminiImageGenInput,
    _context: ProcessContext,
  ): Promise<ModelOutput<GeminiImageGenOutput>> {
    const startTime = performance.now();

    try {
      logger.info('Processing Gemini Image Generation request', {
        prompt: `${params.prompt.substring(0, 100)}...`,
        aspectRatio: params.aspectRatio || '1:1',
        inputImages: params.inputImages?.length || 0,
      });

      // Check for API key
      if (!process.env['GEMINI_API_KEY']) {
        throw new Error('GEMINI_API_KEY is not configured. Please set it in your .env file.');
      }

      // Build the content parts for the request
      const parts = this.buildContentParts(params);

      // Configure the request
      const config: any = {
        imageConfig: {
          aspectRatio: params.aspectRatio || '1:1',
        },
      };

      if (params.responseModalities && params.responseModalities.length > 0) {
        config.responseModalities = params.responseModalities;
      }

      // Call Gemini through the shared resilient transport (header-aware retry +
      // backoff). No hand-rolled fetch/retry per plugin.
      logger.info('Calling Gemini API via resilient transport...');

      const apiKey = process.env['GEMINI_API_KEY'];
      if (!apiKey) {
        // Fail fast: never send a placeholder credential to Google. A missing
        // key is a configuration error, not something to mask behind a 401.
        throw new Error('GEMINI_API_KEY is not configured. Please set it in your .env file.');
      }
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${apiKey}`;

      const response = await resilientTransport.fetchJson(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig: config,
          }),
        },
        geminiResponseSchema,
      );
      const processingTime = Math.round(performance.now() - startTime);

      logger.info(`✅ Gemini API responded in ${processingTime}ms`);

      // Extract images and text from response
      const output = this.extractOutputFromResponse(response);

      logger.info(`📊 Generated ${output.images.length} image(s)`);
      if (output.text) {
        logger.info(`📝 Text: ${output.text.substring(0, 100)}...`);
      }

      return {
        result: output,
        metadata: {
          processingTime,
          modelVersion: this.modelName,
          apiProvider: 'Google Gemini',
          aspectRatio: params.aspectRatio || '1:1',
          hasInputImages: (params.inputImages?.length || 0) > 0,
          mode: params.inputImages?.length ? 'image-editing' : 'text-to-image',
          imagesGenerated: output.images.length,
        },
      };
    } catch (error) {
      logger.error('Gemini Image Generation error', {}, error);

      if (error instanceof Error) {
        throw new Error(`Gemini Image Generation failed: ${error.message}`);
      }

      throw new Error('Gemini Image Generation failed: Unknown error');
    }
  }

  /**
   * Build content parts for Gemini API request
   */
  private buildContentParts(params: GeminiImageGenInput): any {
    const parts: any[] = [];

    // Add input images first if provided (for editing mode)
    if (params.inputImages && params.inputImages.length > 0) {
      for (const image of params.inputImages) {
        parts.push({
          inlineData: {
            mimeType: image.mimeType,
            data: image.data,
          },
        });
      }
    }

    // Add text prompt
    parts.push({
      text: params.prompt,
    });

    return parts;
  }

  /**
   * Extract images and text from Gemini response
   */
  private extractOutputFromResponse(response: GeminiResponse): GeminiImageGenOutput {
    const output: GeminiImageGenOutput = {
      images: [],
    };

    // Process all candidates (usually just one)
    if (response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];

      if (candidate?.content && candidate.content.parts) {
        for (const part of candidate.content.parts) {
          // Extract text
          if (part.text) {
            if (!output.text) {
              output.text = part.text;
            } else {
              output.text += '\n' + part.text;
            }
          }

          // Extract images
          if (part.inlineData) {
            output.images.push({
              data: part.inlineData.data,
              mimeType: part.inlineData.mimeType || 'image/png',
            });
          }
        }
      }
    }

    return output;
  }
}
