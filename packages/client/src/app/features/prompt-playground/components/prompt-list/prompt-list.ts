import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-prompt-list',
  imports: [CommonModule],
  templateUrl: './prompt-list.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptListComponent {
  prompts = input.required<{ name: string; updated_at: string }[]>();
  selectedPromptName = input<string | null>(null);
  isLoading = input.required<boolean>();
  loadError = input<string | null>(null);

  onSelectPrompt = output<string>();

  readonly icons = {
    warning: '⚠️',
  };
}
