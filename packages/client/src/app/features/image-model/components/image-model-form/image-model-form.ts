import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';
import { getFormErrorMessage, hasFormError, markFormGroupTouched } from '../../../../shared/utils/form-validation';

@Component({
  selector: 'app-image-model-form',
  imports: [ReactiveFormsModule],
  templateUrl: './image-model-form.html',
  styleUrl: './image-model-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ImageModelForm {
  form = input.required<FormGroup>();
  loading = input(false);
  hasFile = input(false);
  submitForm = output<void>();
  resetForm = output<void>();

  onSubmit(): void {
    if (this.form().valid && this.hasFile()) {
      this.submitForm.emit();
    } else {
      markFormGroupTouched(this.form());
    }
  }

  onReset(): void {
    this.resetForm.emit();
  }

  getErrorMessage(controlName: string): string | null {
    return getFormErrorMessage(this.form(), controlName);
  }

  hasError(controlName: string): boolean {
    return hasFormError(this.form(), controlName);
  }
}
