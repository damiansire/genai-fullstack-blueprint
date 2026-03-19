import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
import { FormField } from '@angular/forms/signals';

@Component({
  selector: 'app-text-model-form',
  imports: [FormField],
  templateUrl: './text-model-form.html',
  styleUrl: './text-model-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TextModelForm {
  form = input.required<any>();
  loading = input(false);
  submitForm = output<void>();
  resetForm = output<void>();

  onSubmit(): void {
    this.submitForm.emit();
  }

  onReset(): void {
    this.resetForm.emit();
  }
}
