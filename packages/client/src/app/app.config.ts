import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { environment } from '../environments/environment';
import { API_CONFIG } from './core/tokens/api-config';
import { apiKeyInterceptor } from './core/interceptors/api-key.interceptor';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding(), withViewTransitions()),
    provideHttpClient(withFetch(), withInterceptors([apiKeyInterceptor])),
    {
      provide: API_CONFIG,
      useValue: {
        baseUrl: environment.apiUrl || 'http://localhost:3000/api',
        apiKey: environment.apiKey ?? '',
      },
    },
  ],
};
