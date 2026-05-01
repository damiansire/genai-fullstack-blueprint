/**
 * Registry class for managing JSON schemas for model validation
 * Provides a centralized storage for input/output validation schemas
 */
export class SchemaRegistry {
  /**
   * Private map to store JSON schemas
   * Key: modelId (string)
   * Value: JSON Schema object
   */
  private readonly schemaMap = new Map<string, any>();

  /**
   * Register a JSON schema for a specific model
   * @param modelId - Unique identifier for the model
   * @param schema - JSON Schema object for validation
   * @throws Error if modelId is already registered
   */
  register(modelId: string, schema: any): void {
    if (this.schemaMap.has(modelId)) {
      throw new Error(`Schema for model ID '${modelId}' is already registered`);
    }

    // Basic validation to ensure it's a valid JSON Schema
    if (!schema || typeof schema !== 'object') {
      throw new Error(`Invalid schema provided for model ID '${modelId}'. Schema must be a valid JSON Schema object.`);
    }

    this.schemaMap.set(modelId, schema);
  }

  /**
   * Retrieve a JSON schema for a specific model
   * @param modelId - Unique identifier for the model
   * @returns JSON Schema object for the specified model
   * @throws Error if modelId is not registered
   */
  getSchema(modelId: string): any {
    const schema = this.schemaMap.get(modelId);
    
    if (!schema) {
      throw new Error(`Schema for model ID '${modelId}' is not registered`);
    }

    return schema;
  }

  /**
   * Check if a schema is registered for a model
   * @param modelId - Unique identifier for the model
   * @returns True if schema is registered, false otherwise
   */
  hasSchema(modelId: string): boolean {
    return this.schemaMap.has(modelId);
  }

  /**
   * Get list of all registered model IDs with schemas
   * @returns Array of registered model IDs
   */
  getRegisteredModels(): string[] {
    return Array.from(this.schemaMap.keys());
  }

  /**
   * Unregister a schema for a model
   * @param modelId - Unique identifier for the model
   * @returns True if the schema was removed, false if it wasn't registered
   */
  unregister(modelId: string): boolean {
    return this.schemaMap.delete(modelId);
  }

  /**
   * Clear all registered schemas
   */
  clear(): void {
    this.schemaMap.clear();
  }

  /**
   * Get the total number of registered schemas
   * @returns Number of registered schemas
   */
  size(): number {
    return this.schemaMap.size;
  }
}

/**
 * Global singleton instance of the SchemaRegistry
 * This ensures a single point of access for schema registration and retrieval
 */
export const schemaRegistry = new SchemaRegistry();
