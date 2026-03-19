export interface ApiResponseMetadata {
  modelId: string;
  processingTime: number;
  timestamp: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  metadata?: ApiResponseMetadata;
  error?: string;
}

export interface ModelInvocationRequest {
  [key: string]: any;
}

export interface ModelInvocationResponse {
  success: boolean;
  data?: any;
  metadata?: ApiResponseMetadata;
  error?: string;
}

export interface AvailableModel {
  modelId: string;
  available: boolean;
  registeredAt: string;
}

export interface ModelsListResponse {
  success: boolean;
  data: {
    models: AvailableModel[];
    total: number;
  };
}
