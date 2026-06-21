import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { API_CONFIG } from '../tokens/api-config';

/**
 * Injects the `X-API-Key` header into every request that targets the gateway
 * (`baseUrl`). The gateway is fail-closed (rejects unauthenticated calls with
 * 401), so without this header the non-streaming `httpResource` paths all 401.
 *
 * Streaming uses native `fetch` (it bypasses HttpClient), so the header is added
 * manually in those services as well — see `ai-stream.service.ts`.
 */
export const apiKeyInterceptor: HttpInterceptorFn = (req, next) => {
  const apiConfig = inject(API_CONFIG);
  const key = apiConfig.apiKey;

  // Only attach the key to our own gateway, never to third-party URLs.
  if (key && req.url.startsWith(apiConfig.baseUrl)) {
    return next(req.clone({ setHeaders: { 'X-API-Key': key } }));
  }
  return next(req);
};
