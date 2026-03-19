import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { environment } from '../environments/environment';
import { API_CONFIG } from './core/tokens/api-config';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(
      withInterceptors([])
    ),
    {
      provide: API_CONFIG,
      useValue: {
        baseUrl: environment.apiUrl || 'http://localhost:3000/api',
        apiKey: environment.apiKey || ''
      }
    }
  ]
};
