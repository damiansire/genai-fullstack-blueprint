import { Component, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { form, submit, required, pattern, min, max } from '@angular/forms/signals';
import { httpResource } from '@angular/common/http';
import { ModelInvocationResponse } from '../../core/services/api';
import { API_CONFIG } from '../../core/tokens/api-config';
import { FileUpload } from '../../shared/components/file-upload/file-upload';
import { ImageModelForm } from './components/image-model-form/image-model-form';
import { ImageModelResponse } from './components/image-model-response/image-model-response';
import { ModelResponse } from '../../shared/components/model-response/model-response';

@Component({
  selector: 'app-image-model',
  imports: [FileUpload, ImageModelForm, ImageModelResponse, ModelResponse],
  templateUrl: './image-model.html',
  styleUrl: './image-model.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ImageModel {
  private readonly apiConfig = inject(API_CONFIG);

  icons = {
    search: '🔍'
  };

  selectedFile = signal<File | null>(null);
  fileError = signal<string | null>(null);

  requestParams = signal<{
    file: File;
    params: {
      language: string;
      maxResults: number;
      confidenceThreshold: number;
      includeBoundingBoxes: boolean;
      outputFormat: string;
    };
  } | undefined>(undefined);

  imageModelResource = httpResource<ModelInvocationResponse>(() => {
    const params = this.requestParams();
    if (!params) {
      return undefined;
    }

    const formData = new FormData();
    formData.append('imageFile', params.file);
    Object.entries(params.params).forEach(([key, value]) => {
      formData.append(key, String(value));
    });

    return {
      url: `${this.apiConfig.baseUrl}/models/google-vision-ocr/invoke`,
      method: 'POST',
      body: formData,
      headers: {}
    };
  });

  imageModel = signal({
    language: 'en',
    maxResults: 10,
    confidenceThreshold: 0.8,
    includeBoundingBoxes: true,
    outputFormat: 'structured'
  });

  imageForm = form(this.imageModel, (s) => {
    required(s.language, { message: 'Language is required' });
    pattern(s.language, /^[a-z]{2}(-[A-Z]{2})?$/, { message: 'Language format is invalid' });
    min(s.maxResults, 1, { message: 'Max Results must be at least 1' });
    max(s.maxResults, 100, { message: 'Max Results must not exceed 100' });
    min(s.confidenceThreshold, 0, { message: 'Confidence Threshold must be at least 0' });
    max(s.confidenceThreshold, 1, { message: 'Confidence Threshold must not exceed 1' });
    required(s.outputFormat, { message: 'Output Format is required' });
  });

  onFileChange(file: File | null): void {
    this.selectedFile.set(file);
    this.fileError.set(null);
  }

  onFileError(errorMessage: string): void {
    this.fileError.set(errorMessage);
  }

  onSubmit(): void {
    submit(this.imageForm, async () => {
      const file = this.selectedFile();
      if (!file) {
        this.fileError.set('No file selected');
        return;
      }

      const model = this.imageModel();
      this.requestParams.set({
        file,
        params: {
          language: model.language,
          maxResults: model.maxResults,
          confidenceThreshold: model.confidenceThreshold,
          includeBoundingBoxes: model.includeBoundingBoxes,
          outputFormat: model.outputFormat
        }
      });
    });
  }

  resetForm(): void {
    this.imageModel.set({
      language: 'en',
      maxResults: 10,
      confidenceThreshold: 0.8,
      includeBoundingBoxes: true,
      outputFormat: 'structured'
    });
    this.selectedFile.set(null);
    this.fileError.set(null);
    this.requestParams.set(undefined);
  }
}
