import { Component, input, output, computed, ChangeDetectionStrategy } from '@angular/core';
import {
  CodeGenerationResult,
  SupportedLanguage,
} from '../../../../core/services/ai-orchestrator.service';

@Component({
  selector: 'app-code-result',
  templateUrl: './code-result.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeResultComponent {
  result = input.required<CodeGenerationResult>();
  langIcons = input.required<Record<SupportedLanguage, string>>();
  copied = input<boolean>(false);

  onCopyCode = output<void>();

  qualityColor = computed(() => {
    const score = this.result().metrics.qualityScore ?? 0;
    if (score >= 80) return '#22c55e';
    if (score >= 60) return '#eab308';
    return '#ef4444';
  });

  qualityLabel = computed(() => {
    const score = this.result().metrics.qualityScore ?? 0;
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Fair';
    return 'Needs Work';
  });

  metricBar(value: number, max: number): string {
    return `${Math.min(100, Math.round((value / max) * 100))}%`;
  }

  trackBySuggestion(_: number, s: string) {
    return s;
  }
}
