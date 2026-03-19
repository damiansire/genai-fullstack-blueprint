import { InjectionToken } from '@angular/core';

export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
}

export const API_CONFIG = new InjectionToken<ApiConfig>('API_CONFIG');
