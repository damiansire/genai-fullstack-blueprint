import { pipeline } from '@xenova/transformers';
import { logger } from '../core/logger.js';

// Disable fetching models from huggingface locally if preferred, but usually we let it cache.
// env.allowLocalModels = true;
// env.useBrowserCache = false;

export class EmbeddingService {
  private static instance: EmbeddingService;
  private extractor: any = null;

  private constructor() {}

  public static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
  }

  public async initialize(): Promise<void> {
    if (this.extractor) return;
    try {
      logger.info('Initializing local embedding model (Xenova/gte-base)...');
      // Load the feature extraction pipeline using Xenova/gte-base
      this.extractor = await pipeline('feature-extraction', 'Xenova/gte-base', {
        quantized: true, // Use quantized version for faster inference and lower memory
      });
      logger.info('Local embedding model initialized successfully.');
    } catch (error) {
      logger.error(
        'Failed to initialize local embedding model',
        {},
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  public async generateEmbedding(text: string): Promise<Float32Array> {
    if (!this.extractor) {
      await this.initialize();
    }

    // Generate embeddings
    const output = await this.extractor(text, { pooling: 'mean', normalize: true });
    return output.data as Float32Array;
  }
}

export const embeddingService = EmbeddingService.getInstance();
