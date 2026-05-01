import { IModelStrategy, ProcessContext, ModelOutput } from '../../domain/ai/strategy.interface.js';
import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers/promises';
import { randomInt } from 'node:crypto';
import { logger } from '../../core/logger.js';

/**
 * Model ID for Google Vision OCR
 */
export const modelId = 'google-vision-ocr';

/**
 * JSON Schema for Google Vision OCR configuration
 * Defines the required input structure for the model
 */
export const configSchema = {
  type: 'object',
  properties: {
    imageFile: {
      type: 'string',
      description: 'Image file for OCR processing',
      format: 'binary'
    },
    language: {
      type: 'string',
      description: 'Language hint for OCR (e.g., "en", "es", "fr")',
      pattern: '^[a-z]{2}(-[A-Z]{2})?$',
      default: 'en'
    },
    maxResults: {
      type: 'number',
      description: 'Maximum number of text annotations to return',
      minimum: 1,
      maximum: 100,
      default: 10
    },
    confidenceThreshold: {
      type: 'number',
      description: 'Minimum confidence score for text detection',
      minimum: 0.0,
      maximum: 1.0,
      default: 0.8
    },
    includeBoundingBoxes: {
      type: 'boolean',
      description: 'Whether to include bounding box coordinates',
      default: true
    },
    outputFormat: {
      type: 'string',
      enum: ['text', 'json', 'structured'],
      description: 'Format of the OCR output',
      default: 'structured'
    }
  },
  required: ['imageFile'],
  additionalProperties: true,
  // Custom property to indicate file upload requirement
  'x-multipart-media': {
    fieldName: 'imageFile',
    allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'],
    maxSize: 10485760 // 10MB
  }
};

/**
 * Input interface for Google Vision OCR
 */
interface GoogleVisionOCRInput {
  imageFile: {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
    path?: string;
  };
  language?: string;
  maxResults?: number;
  confidenceThreshold?: number;
  includeBoundingBoxes?: boolean;
  outputFormat?: 'text' | 'json' | 'structured';
}

/**
 * Bounding box interface for text detection
 */
interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Text annotation interface
 */
interface TextAnnotation {
  text: string;
  confidence: number;
  boundingBox?: BoundingBox;
  language?: string;
}

/**
 * Output interface for Google Vision OCR
 */
interface GoogleVisionOCROutput {
  text: string;
  annotations: TextAnnotation[];
  language: string;
  confidence: number;
  imageInfo: {
    width: number;
    height: number;
    format: string;
    size: number;
  };
  processingTime: number;
}

/**
 * Google Vision OCR Model Strategy Implementation
 * Simulates calls to Google's Vision OCR API
 */
export class ModelStrategy implements IModelStrategy<GoogleVisionOCRInput, ModelOutput<GoogleVisionOCROutput>> {
  private readonly modelName = 'vision-ocr-v1';

  /**
   * Process an OCR request
   * @param params - Input parameters for OCR processing
   * @param context - Processing context with API key and user info
   * @returns Promise resolving to the OCR response
   */
  async process(
    params: GoogleVisionOCRInput, 
    context: ProcessContext
  ): Promise<ModelOutput<GoogleVisionOCROutput>> {
    const startTime = performance.now();

    try {
      // Validate required parameters
      if (!params.imageFile || !params.imageFile.buffer) {
        throw new Error('Image file is required for OCR processing');
      }

      // Validate API key
      if (!context.apiKey) {
        throw new Error('API key is required for Google Vision OCR');
      }

      // Validate image format
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
      if (!allowedTypes.includes(params.imageFile.mimetype)) {
        throw new Error(`Unsupported image format: ${params.imageFile.mimetype}`);
      }

      // Validate file size (10MB limit)
      if (params.imageFile.size > 10 * 1024 * 1024) {
        throw new Error('Image file size exceeds 10MB limit');
      }

      // Prepare request parameters with defaults
      const requestParams = {
        language: params.language || 'en',
        maxResults: params.maxResults || 10,
        confidenceThreshold: params.confidenceThreshold || 0.8,
        includeBoundingBoxes: params.includeBoundingBoxes !== false,
        outputFormat: params.outputFormat || 'structured'
      };

      // Log the request
      logger.info(`🔍 Processing Google Vision OCR request`, {
        imageSize: params.imageFile.size,
        imageType: params.imageFile.mimetype,
        language: requestParams.language,
        maxResults: requestParams.maxResults,
        userId: context.userId,
        timestamp: new Date().toISOString()
      });

      // Simulate API call to Google Vision OCR
      const response = await this.simulateGoogleVisionOCRCall(params, requestParams, context.apiKey);

      const processingTime = Math.round(performance.now() - startTime);

      // Log successful response
      logger.info(`✅ Google Vision OCR request completed`, {
        textLength: response.text.length,
        annotationsCount: response.annotations.length,
        processingTime: `${processingTime}ms`,
        confidence: response.confidence
      });

      return {
        result: response,
        metadata: {
          processingTime,
          modelVersion: this.modelName,
          apiProvider: 'Google',
          timestamp: new Date().toISOString(),
          imageProcessed: true
        }
      };

    } catch (error) {
      const processingTime = Math.round(performance.now() - startTime);
      
      logger.error('Google Vision OCR request failed', {
        processingTime: `${processingTime}ms`
      }, error);

      throw error;
    }
  }

  /**
   * Simulate a call to Google Vision OCR API
   * In a real implementation, this would make an actual HTTP request
   * @param params - Request parameters
   * @param options - Processing options
   * @param apiKey - Google API key
   * @returns Simulated response
   */
  private async simulateGoogleVisionOCRCall(
    params: GoogleVisionOCRInput,
    options: any,
    _apiKey: string
  ): Promise<GoogleVisionOCROutput> {
    // Simulate API delay
    await setTimeout(2000 + randomInt(3000));

    // Simulate different OCR scenarios based on image type
    const scenarios = this.generateOCRScenarios(params.imageFile.mimetype, options);

    // Randomly select a scenario
    const selectedScenario = scenarios[randomInt(scenarios.length)];

    // Simulate occasional errors
    if (randomInt(100) < 3) { // 3% error rate
      throw new Error('Simulated API error: Image processing failed');
    }

    if (!selectedScenario) {
      throw new Error('No scenario selected');
    }

    return selectedScenario;
  }

  /**
   * Generate different OCR scenarios based on image type
   * @param mimeType - Image MIME type
   * @param options - Processing options
   * @returns Array of simulated OCR responses
   */
  private generateOCRScenarios(mimeType: string, options: any): GoogleVisionOCROutput[] {
    const baseScenarios = [
      {
        text: "This is a sample text extracted from an image using Google Vision OCR. The technology can recognize text in various languages and formats.",
        annotations: [
          {
            text: "This is a sample text",
            confidence: 0.95,
            boundingBox: { x: 10, y: 20, width: 200, height: 30 },
            language: options.language
          },
          {
            text: "extracted from an image",
            confidence: 0.92,
            boundingBox: { x: 10, y: 60, width: 180, height: 25 },
            language: options.language
          },
          {
            text: "using Google Vision OCR",
            confidence: 0.88,
            boundingBox: { x: 10, y: 100, width: 220, height: 28 },
            language: options.language
          }
        ],
        language: options.language,
        confidence: 0.92,
        imageInfo: {
          width: 800,
          height: 600,
          format: (mimeType.split('/')[1] || 'UNKNOWN').toUpperCase(),
          size: 1024000
        },
        processingTime: 2500
      },
      {
        text: "Document OCR: Invoice #12345\nDate: 2024-01-15\nAmount: $1,234.56\nStatus: Paid",
        annotations: [
          {
            text: "Invoice #12345",
            confidence: 0.98,
            boundingBox: { x: 50, y: 100, width: 150, height: 35 },
            language: options.language
          },
          {
            text: "Date: 2024-01-15",
            confidence: 0.94,
            boundingBox: { x: 50, y: 150, width: 140, height: 30 },
            language: options.language
          },
          {
            text: "Amount: $1,234.56",
            confidence: 0.96,
            boundingBox: { x: 50, y: 200, width: 160, height: 30 },
            language: options.language
          },
          {
            text: "Status: Paid",
            confidence: 0.90,
            boundingBox: { x: 50, y: 250, width: 120, height: 28 },
            language: options.language
          }
        ],
        language: options.language,
        confidence: 0.94,
        imageInfo: {
          width: 600,
          height: 400,
          format: (mimeType.split('/')[1] || 'UNKNOWN').toUpperCase(),
          size: 512000
        },
        processingTime: 2800
      },
      {
        text: "Handwritten Note: Remember to buy groceries\n- Milk\n- Bread\n- Eggs\n- Apples",
        annotations: [
          {
            text: "Remember to buy groceries",
            confidence: 0.85,
            boundingBox: { x: 20, y: 30, width: 250, height: 25 },
            language: options.language
          },
          {
            text: "Milk",
            confidence: 0.88,
            boundingBox: { x: 40, y: 70, width: 50, height: 20 },
            language: options.language
          },
          {
            text: "Bread",
            confidence: 0.87,
            boundingBox: { x: 40, y: 100, width: 60, height: 20 },
            language: options.language
          },
          {
            text: "Eggs",
            confidence: 0.89,
            boundingBox: { x: 40, y: 130, width: 45, height: 20 },
            language: options.language
          },
          {
            text: "Apples",
            confidence: 0.86,
            boundingBox: { x: 40, y: 160, width: 70, height: 20 },
            language: options.language
          }
        ],
        language: options.language,
        confidence: 0.87,
        imageInfo: {
          width: 400,
          height: 300,
          format: (mimeType.split('/')[1] || 'UNKNOWN').toUpperCase(),
          size: 256000
        },
        processingTime: 3200
      }
    ];

    // Add language-specific scenarios
    if (options.language === 'es') {
      baseScenarios.push({
        text: "Texto extraído de una imagen usando OCR. Esta tecnología puede reconocer texto en varios idiomas.",
        annotations: [
          {
            text: "Texto extraído de una imagen",
            confidence: 0.93,
            boundingBox: { x: 10, y: 20, width: 220, height: 30 },
            language: options.language
          },
          {
            text: "usando OCR",
            confidence: 0.91,
            boundingBox: { x: 10, y: 60, width: 100, height: 25 },
            language: options.language
          }
        ],
        language: options.language,
        confidence: 0.92,
        imageInfo: {
          width: 500,
          height: 200,
          format: (mimeType.split('/')[1] || 'UNKNOWN').toUpperCase(),
          size: 128000
        },
        processingTime: 2400
      });
    }

    return baseScenarios;
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
      type: 'image-ocr',
      capabilities: ['text-extraction', 'ocr', 'document-analysis'],
      maxFileSize: 10485760, // 10MB
      supportedFormats: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'],
      supportsBoundingBoxes: true,
      supportsLanguageDetection: true
    };
  }
}