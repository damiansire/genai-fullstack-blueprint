import { IModelStrategy } from '../../domain/ai/strategy.interface.js';

/**
 * Factory class for creating and managing model strategies
 * Provides a centralized registry for different AI model implementations
 */
export class ModelFactory {
  /**
   * Private map to store model strategy constructors
   * Key: modelId (string)
   * Value: creator function that returns an IModelStrategy instance
   */
  private readonly strategyRegistry = new Map<string, () => IModelStrategy<any, any>>();

  /**
   * Register a new model strategy with the factory
   * @param modelId - Unique identifier for the model strategy
   * @param creator - Function that creates and returns a new strategy instance
   * @throws Error if modelId is already registered
   */
  register(modelId: string, creator: () => IModelStrategy<any, any>): void {
    if (this.strategyRegistry.has(modelId)) {
      throw new Error(`Model strategy with ID '${modelId}' is already registered`);
    }

    this.strategyRegistry.set(modelId, creator);
  }

  /**
   * Create a new instance of a registered model strategy
   * @param modelId - Unique identifier for the model strategy to create
   * @returns New instance of the requested model strategy
   * @throws Error if modelId is not registered
   */
  create(modelId: string): IModelStrategy<any, any> {
    const creator = this.strategyRegistry.get(modelId);

    if (!creator) {
      throw new Error(`Model strategy with ID '${modelId}' is not registered`);
    }

    return creator();
  }

  /**
   * Check if a model strategy is registered
   * @param modelId - Unique identifier for the model strategy
   * @returns True if the model strategy is registered, false otherwise
   */
  isRegistered(modelId: string): boolean {
    return this.strategyRegistry.has(modelId);
  }

  /**
   * Get list of all registered model IDs
   * @returns Array of registered model strategy IDs
   */
  getRegisteredModels(): string[] {
    return Array.from(this.strategyRegistry.keys());
  }

  /**
   * Unregister a model strategy
   * @param modelId - Unique identifier for the model strategy to remove
   * @returns True if the model was removed, false if it wasn't registered
   */
  unregister(modelId: string): boolean {
    return this.strategyRegistry.delete(modelId);
  }
}

/**
 * Global singleton instance of the ModelFactory
 * This ensures a single point of access for model strategy registration and creation
 */
export const modelFactory = new ModelFactory();
