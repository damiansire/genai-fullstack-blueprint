import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormField } from '../../../../shared/components/dynamic-tool-form/dynamic-tool-form';

@Component({
  selector: 'app-prompt-editor',
  imports: [CommonModule, FormField],
  templateUrl: './prompt-editor.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptEditorComponent {
  prompt = input.required<{ name: string }>();
  promptForm = input.required<any>(); // Reusing the specific form group structure from the parent
  isSaving = input.required<boolean>();
  saveSuccess = input.required<boolean>();
  saveError = input<string | null>(null);

  onSubmit = output<void>();

  readonly icons = {
    save: '💾',
    check: '✅',
    warning: '⚠️',
  };
}
