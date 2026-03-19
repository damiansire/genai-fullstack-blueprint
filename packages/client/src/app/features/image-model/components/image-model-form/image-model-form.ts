import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
import { FormField } from '@angular/forms/signals';

@Component({
  selector: 'app-image-model-form',
  imports: [FormField],
  templateUrl: './image-model-form.html',
  styleUrl: './image-model-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ImageModelForm {
  form = input.required<any>();
  loading = input(false);
  hasFile = input(false);
  submitForm = output<void>();
  resetForm = output<void>();

  onSubmit(): void {
    this.submitForm.emit();
  }

  onReset(): void {
    this.resetForm.emit();
  }
}
