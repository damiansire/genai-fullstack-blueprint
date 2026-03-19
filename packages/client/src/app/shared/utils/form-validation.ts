import { FormGroup } from '@angular/forms';

export function getFormErrorMessage(form: FormGroup, controlName: string): string | null {
  const control = form.get(controlName);

  if (control?.errors && control.touched) {
    if (control.errors['required']) {
      return `${controlName} is required`;
    }
    if (control.errors['minlength']) {
      return `${controlName} must be at least ${control.errors['minlength'].requiredLength} characters`;
    }
    if (control.errors['maxlength']) {
      return `${controlName} must not exceed ${control.errors['maxlength'].requiredLength} characters`;
    }
    if (control.errors['min']) {
      return `${controlName} must be at least ${control.errors['min'].min}`;
    }
    if (control.errors['max']) {
      return `${controlName} must not exceed ${control.errors['max'].max}`;
    }
    if (control.errors['pattern']) {
      return `${controlName} format is invalid`;
    }
  }

  return null;
}

export function hasFormError(form: FormGroup, controlName: string): boolean {
  const control = form.get(controlName);
  return !!(control?.errors && control.touched);
}

export function markFormGroupTouched(form: FormGroup): void {
  Object.keys(form.controls).forEach(key => {
    const control = form.get(key);
    control?.markAsTouched();
  });
}
