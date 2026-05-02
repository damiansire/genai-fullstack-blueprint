import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
import { SupportedLanguage } from '../../../../core/services/ai-orchestrator.service';

@Component({
  selector: 'app-code-config',
  templateUrl: './code-config.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeConfigComponent {
  languages = input.required<SupportedLanguage[]>();
  langIcons = input.required<Record<SupportedLanguage, string>>();
  activeLanguage = input.required<SupportedLanguage>();
  specText = input.required<string>();
  isGenerating = input.required<boolean>();
  isCaching = input.required<boolean>();

  onLanguageSelect = output<SupportedLanguage>();
  onSpecChange = output<string>();
  onGenerate = output<void>();
  onLoadExample = output<void>();

  get hasSpec(): boolean {
    return this.specText().trim().length > 0;
  }

  onInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this.onSpecChange.emit(target.value);
  }
}
