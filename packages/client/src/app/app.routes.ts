import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: '/text-model',
    pathMatch: 'full'
  },
  {
    path: 'text-model',
    loadComponent: () => import('./features/text-model/text-model').then(m => m.TextModel),
    title: 'Text Generation - AI Gateway'
  },
  {
    path: 'image-ocr',
    loadComponent: () => import('./features/image-model/image-model').then(m => m.ImageModel),
    title: 'Image OCR - AI Gateway'
  },
  {
    path: 'image-generation',
    loadComponent: () => import('./features/image-generation/image-generation').then(m => m.ImageGeneration),
    title: 'Image Generation - Nano Banana'
  },
  // Legacy redirect
  {
    path: 'image-model',
    redirectTo: '/image-ocr'
  },
  {
    path: '**',
    redirectTo: '/text-model'
  }
];
