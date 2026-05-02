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
  {
    path: 'tool-explorer',
    loadComponent: () => import('./features/tool-explorer/tool-explorer').then(m => m.ToolExplorer),
    title: 'Tool Explorer - AI Gateway'
  },
  {
    path: 'security',
    loadComponent: () => import('./features/security-dashboard/security-dashboard').then(m => m.SecurityDashboard),
    title: 'Security Analyzer - AI Gateway'
  },
  {
    path: 'iot',
    loadComponent: () => import('./features/iot-dashboard/iot-dashboard').then(m => m.IotDashboard),
    title: 'IoT Telemetry - AI Gateway'
  },
  {
    path: 'code-gen',
    loadComponent: () => import('./features/code-generator/code-generator').then(m => m.CodeGenerator),
    title: 'Code Generator - AI Gateway'
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
