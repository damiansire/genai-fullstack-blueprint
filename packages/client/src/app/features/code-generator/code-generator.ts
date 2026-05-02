/**
 * CodeGenerator — Patrón 10: DevTools Code Generation (Frontend)
 */
import {
  Component,
  signal,
  computed,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { API_CONFIG } from '../../core/tokens/api-config';

type SupportedLanguage = 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | 'sql';

interface CodeQualityMetrics {
  linesOfCode: number;
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  commentRatio: number;
  securitySmells: string[];
  codeSmells: string[];
  qualityScore: number;
}

interface CodeGenerationResult {
  language: SupportedLanguage;
  spec: string;
  code: string;
  metrics: CodeQualityMetrics;
  suggestions: string[];
  refinementRounds: number;
  processingMs: number;
  timestamp: string;
}

const EXAMPLE_SPECS: Record<SupportedLanguage, string> = {
  typescript: 'Create a type-safe HTTP retry function with exponential backoff and circuit breaker pattern',
  javascript: 'Build a debounced event emitter with wildcard subscriptions and once() support',
  python: 'Implement a rate limiter using the token bucket algorithm with Redis-compatible interface',
  go: 'Write a concurrent worker pool with graceful shutdown and panic recovery',
  rust: 'Create a zero-copy CSV parser that streams records without heap allocation',
  sql: 'Design a query to find the top 10 customers by monthly revenue with year-over-year growth',
};

@Component({
  selector: 'app-code-generator',
  standalone: true,
  imports: [],
  templateUrl: './code-generator.html',
  styleUrl: './code-generator.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeGenerator {
  private readonly apiConfig = inject(API_CONFIG);

  readonly languages: SupportedLanguage[] = ['typescript', 'javascript', 'python', 'go', 'rust', 'sql'];
  readonly langIcons: Record<SupportedLanguage, string> = {
    typescript: '🔷', javascript: '🟨', python: '🐍',
    go: '🐹', rust: '🦀', sql: '🗄️',
  };

  // ─── Form state ─────────────────────────────────────────────────────────
  spec = signal('');
  language = signal<SupportedLanguage>('typescript');
  isGenerating = signal(false);
  result = signal<CodeGenerationResult | null>(null);
  error = signal<string | null>(null);
  copied = signal(false);

  // ─── Computed ────────────────────────────────────────────────────────────
  readonly hasSpec = computed(() => this.spec().trim().length > 0);
  readonly qualityColor = computed(() => {
    const score = this.result()?.metrics.qualityScore ?? 0;
    if (score >= 80) return '#22c55e';
    if (score >= 60) return '#eab308';
    return '#ef4444';
  });
  readonly qualityLabel = computed(() => {
    const score = this.result()?.metrics.qualityScore ?? 0;
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Fair';
    return 'Needs Work';
  });

  // ─── Actions ──────────────────────────────────────────────────────────────
  onSpecInput(e: Event): void {
    this.spec.set((e.target as HTMLTextAreaElement).value);
  }

  selectLanguage(lang: SupportedLanguage): void {
    this.language.set(lang);
  }

  loadExample(): void {
    this.spec.set(EXAMPLE_SPECS[this.language()]);
  }

  async generate(): Promise<void> {
    if (!this.hasSpec()) return;
    this.isGenerating.set(true);
    this.result.set(null);
    this.error.set(null);

    try {
      const res = await fetch(`${this.apiConfig.baseUrl}/domain/code/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec: this.spec(), language: this.language() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      this.result.set(await res.json());
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      this.isGenerating.set(false);
    }
  }

  async copyCode(): Promise<void> {
    const code = this.result()?.code;
    if (!code) return;
    await navigator.clipboard.writeText(code);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2000);
  }

  metricBar(value: number, max: number): string {
    return `${Math.min(100, Math.round((value / max) * 100))}%`;
  }

  trackBySuggestion(_: number, s: string) { return s; }
}
