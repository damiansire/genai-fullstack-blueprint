import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { HttpRequest, type HttpEvent, type HttpHandlerFn } from '@angular/common/http';
import { of } from 'rxjs';
import { apiKeyInterceptor } from './api-key.interceptor';
import { API_CONFIG, type ApiConfig } from '../tokens/api-config';

const BASE_URL = 'http://gateway.test/api';

function runInterceptor(config: Partial<ApiConfig>, url: string): HttpRequest<unknown> {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: API_CONFIG, useValue: { baseUrl: BASE_URL, ...config } },
    ],
  });

  let forwarded: HttpRequest<unknown> | undefined;
  const next: HttpHandlerFn = vi.fn((req) => {
    forwarded = req;
    return of({} as HttpEvent<unknown>);
  });

  const request = new HttpRequest('GET', url);
  TestBed.runInInjectionContext(() => apiKeyInterceptor(request, next)).subscribe();
  return forwarded!;
}

describe('apiKeyInterceptor', () => {
  it('attaches X-API-Key to requests targeting the gateway baseUrl', () => {
    const forwarded = runInterceptor({ apiKey: 'k-123' }, `${BASE_URL}/models`);
    expect(forwarded.headers.get('X-API-Key')).toBe('k-123');
  });

  it('never leaks the key to third-party URLs', () => {
    const forwarded = runInterceptor({ apiKey: 'k-123' }, 'https://third-party.example/api');
    expect(forwarded.headers.has('X-API-Key')).toBe(false);
  });

  it('passes the request through untouched when no key is configured', () => {
    const forwarded = runInterceptor({}, `${BASE_URL}/models`);
    expect(forwarded.headers.has('X-API-Key')).toBe(false);
  });
});
