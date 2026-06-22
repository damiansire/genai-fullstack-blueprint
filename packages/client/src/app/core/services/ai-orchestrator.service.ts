import { Injectable, inject } from '@angular/core';
import { API_CONFIG } from '../tokens/api-config';

export interface ContextCacheResult {
  cacheId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  action: 'create' | 'get';
  processingMs: number;
}

export type SupportedLanguage = 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | 'sql';

export interface CodeQualityMetrics {
  linesOfCode: number;
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  commentRatio: number;
  securitySmells: string[];
  codeSmells: string[];
  qualityScore: number;
}

export interface CodeGenerationResult {
  language: SupportedLanguage;
  spec: string;
  code: string;
  metrics: CodeQualityMetrics;
  suggestions: string[];
  refinementRounds: number;
  processingMs: number;
  timestamp: string;
  cacheId?: string; // Optional context cache reference
}

@Injectable({ providedIn: 'root' })
export class AiOrchestratorService {
  private readonly apiConfig = inject(API_CONFIG);

  /**
   * Generates a context cache for a given payload (simulating RAG document upload)
   */
  async cacheContext(
    fileName: string,
    mimeType: string,
    payload: string,
  ): Promise<ContextCacheResult> {
    const sizeBytes = new Blob([payload]).size;
    const res = await fetch(`${this.apiConfig.baseUrl}/domain/context-cache`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, mimeType, sizeBytes }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    return res.json();
  }

  /**
   * Generates code by optionally utilizing a pre-cached context ID
   */
  async generateCode(
    spec: string,
    language: SupportedLanguage,
    cacheId?: string,
  ): Promise<CodeGenerationResult> {
    const res = await fetch(`${this.apiConfig.baseUrl}/domain/code/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec, language, cacheId }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }

    const data = await res.json();
    return { ...data, cacheId };
  }
}
