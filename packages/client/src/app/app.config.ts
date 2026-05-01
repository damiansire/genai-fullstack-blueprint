import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { environment } from '../environments/environment';
import { API_CONFIG } from './core/tokens/api-config';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withViewTransitions()
    ),
    provideHttpClient(withFetch()),
    {
      provide: API_CONFIG,
      useValue: {
        baseUrl: environment.apiUrl || 'http://localhost:3000/api'
      }
    }
  ]
};
