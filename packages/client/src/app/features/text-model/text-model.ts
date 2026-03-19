import { Component, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { httpResource } from '@angular/common/http';
import { ModelInvocationResponse } from '../../core/services/api';
import { API_CONFIG } from '../../core/tokens/api-config';
import { TextModelForm } from './components/text-model-form/text-model-form';
import { TextModelResponse } from './components/text-model-response/text-model-response';
import { ModelResponse } from '../../shared/components/model-response/model-response';

@Component({
  selector: 'app-text-model',
  imports: [TextModelForm, TextModelResponse, ModelResponse],
  templateUrl: './text-model.html',
  styleUrl: './text-model.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TextModel {
  private readonly apiConfig = inject(API_CONFIG);

  // Request signal to trigger API calls
  requestParams = signal<{
    prompt: string;
    maxTokens: number;
    temperature: number;
    topP: number;
    topK: number;
  } | undefined>(undefined);

  // HttpResource for reactive HTTP calls
  textModelResource = httpResource<ModelInvocationResponse>(() => {
    const params = this.requestParams();
    if (!params) {
      return undefined; // No request when no params
    }
    
    return {
      url: `${this.apiConfig.baseUrl}/models/google-text-bison/invoke`,
      method: 'POST',
      body: params,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiConfig.apiKey
      }
    };
  });

  // Reactive form
  textForm = new FormGroup({
    prompt: new FormControl('', [
      Validators.required,
      Validators.minLength(1),
      Validators.maxLength(8192)
    ]),
    maxTokens: new FormControl(256, [
      Validators.min(1),
      Validators.max(1024)
    ]),
    temperature: new FormControl(0.7, [
      Validators.min(0.0),
      Validators.max(1.0)
    ]),
    topP: new FormControl(0.9, [
      Validators.min(0.0),
      Validators.max(1.0)
    ]),
    topK: new FormControl(40, [
      Validators.min(1),
      Validators.max(100)
    ])
  });

  /**
   * Handle form submission
   */
  onSubmit(): void {
    const formValue = this.textForm.value;
    
    // Update request params to trigger resource loading
    this.requestParams.set({
      prompt: formValue.prompt!,
      maxTokens: formValue.maxTokens!,
      temperature: formValue.temperature!,
      topP: formValue.topP!,
      topK: formValue.topK!
    });
  }

  /**
   * Reset the form and clear state
   */
  resetForm(): void {
    this.textForm.reset({
      prompt: '',
      maxTokens: 256,
      temperature: 0.7,
      topP: 0.9,
      topK: 40
    });
    this.requestParams.set(undefined);
  }
}
