/**
 * Context information passed to model strategies during processing
 */
export type ProcessContext = {
  /** API key for authentication with external services */
  apiKey?: string | undefined;
  /** User identifier for tracking and authorization */
  userId?: string | undefined;
};

/**
 * Metadata about model processing
 */
export type ModelMetadata = {
  /** Processing time in milliseconds */
  processingTime?: number;
  /** Model version or identifier used */
  modelVersion?: string;
  /** Model identifier */
  modelId?: string;
  /** API provider name */
  apiProvider?: string;
  /** Timestamp of processing */
  timestamp?: string;
  /** Additional context or information */
  [key: string]: any;
};

/**
 * Standard output structure for model responses
 */
export type ModelOutput<T = any> = {
  /** The main result from the model processing */
  result: T;
  /** Additional metadata about the processing */
  metadata?: ModelMetadata;
};

