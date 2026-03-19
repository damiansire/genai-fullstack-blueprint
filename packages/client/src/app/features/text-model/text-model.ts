import { Component, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { form, submit, required, minLength, maxLength, min, max } from '@angular/forms/signals';
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

  requestParams = signal<{
    prompt: string;
    maxTokens: number;
    temperature: number;
    topP: number;
    topK: number;
  } | undefined>(undefined);

  textModelResource = httpResource<ModelInvocationResponse>(() => {
    const params = this.requestParams();
    if (!params) {
      return undefined;
    }

    return {
      url: `${this.apiConfig.baseUrl}/models/google-text-bison/invoke`,
      method: 'POST',
      body: params,
      headers: {
        'Content-Type': 'application/json'
      }
    };
  });

  textModel = signal({
    prompt: '',
    maxTokens: 256,
    temperature: 0.7,
    topP: 0.9,
    topK: 40
  });

  textForm = form(this.textModel, (s) => {
    required(s.prompt, { message: 'Prompt is required' });
    minLength(s.prompt, 1);
    maxLength(s.prompt, 8192, { message: 'Prompt must not exceed 8192 characters' });
    min(s.maxTokens, 1, { message: 'Max Tokens must be at least 1' });
    max(s.maxTokens, 1024, { message: 'Max Tokens must not exceed 1024' });
    min(s.temperature, 0, { message: 'Temperature must be at least 0' });
    max(s.temperature, 1, { message: 'Temperature must not exceed 1' });
    min(s.topP, 0, { message: 'Top P must be at least 0' });
    max(s.topP, 1, { message: 'Top P must not exceed 1' });
    min(s.topK, 1, { message: 'Top K must be at least 1' });
    max(s.topK, 100, { message: 'Top K must not exceed 100' });
  });

  onSubmit(): void {
    submit(this.textForm, async () => {
      const model = this.textModel();
      this.requestParams.set({
        prompt: model.prompt,
        maxTokens: model.maxTokens,
        temperature: model.temperature,
        topP: model.topP,
        topK: model.topK
      });
    });
  }

  resetForm(): void {
    this.textModel.set({
      prompt: '',
      maxTokens: 256,
      temperature: 0.7,
      topP: 0.9,
      topK: 40
    });
    this.requestParams.set(undefined);
  }
}
