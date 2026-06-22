/**
 * Generic API Response structure
 * @template T - Type of the data payload
 * @template M - Type of the metadata (defaults to Record<string, any>)
 */
export type ApiResponse<T = any, M = Record<string, any>> = {
  success: boolean;
  data?: T;
  metadata?: M;
  error?: string;
};
