import type { ProcessContext } from './types.js';

export { ProcessContext, ModelMetadata, ModelOutput } from './types.js';

/**
 * Generic interface for model strategies that process input and return output
 * @template TInput - Type of input data
 * @template TOutput - Type of output data
 */
export interface IModelStrategy<TInput, TOutput> {
  /**
   * Process input data using the model strategy
   * @param params - Input parameters for processing
   * @param context - Context information (API keys, user info, etc.)
   * @returns Promise resolving to the processed output
   */
  process(params: TInput, context: ProcessContext): Promise<TOutput>;
}
