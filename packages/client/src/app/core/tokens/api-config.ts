import { InjectionToken } from '@angular/core';

export interface ApiConfig {
  baseUrl: string;
  /**
   * API key sent as the `X-API-Key` header on every gateway request.
   *
   * NOTE: in production a browser bundle must NOT embed a privileged key — the
   * recommended deployment is a same-origin server-side proxy that injects the
   * key out of band. This field exists so local/dev builds authenticate against
   * the fail-closed gateway; keep it empty in production bundles.
   */
  apiKey?: string;
}

export const API_CONFIG = new InjectionToken<ApiConfig>('API_CONFIG');
