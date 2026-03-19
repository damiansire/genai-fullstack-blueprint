import { Component, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
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

  // Signals for state management
  selectedFile = signal<File | null>(null);
  fileError = signal<string | null>(null);

  // Request signal to trigger API calls
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

  // HttpResource for reactive HTTP calls with FormData
  imageModelResource = httpResource<ModelInvocationResponse>(() => {
    const params = this.requestParams();
    if (!params) {
      return undefined; // No request when no params
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
      headers: {
        'X-API-Key': this.apiConfig.apiKey
      }
    };
  });

  // Reactive form
  imageForm = new FormGroup({
    language: new FormControl('en', [
      Validators.required,
      Validators.pattern(/^[a-z]{2}(-[A-Z]{2})?$/)
    ]),
    maxResults: new FormControl(10, [
      Validators.min(1),
      Validators.max(100)
    ]),
    confidenceThreshold: new FormControl(0.8, [
      Validators.min(0.0),
      Validators.max(1.0)
    ]),
    includeBoundingBoxes: new FormControl(true),
    outputFormat: new FormControl('structured', [
      Validators.required
    ])
  });

  /**
   * Handle file selection
   */
  onFileSelected(file: File): void {
    this.selectedFile.set(file);
    this.fileError.set(null);
  }

  /**
   * Handle file cleared
   */
  onFileCleared(): void {
    this.selectedFile.set(null);
    this.fileError.set(null);
  }

  /**
   * Handle file upload error
   */
  onFileError(errorMessage: string): void {
    this.fileError.set(errorMessage);
  }

  /**
   * Handle form submission
   */
  onSubmit(): void {
    const formValue = this.imageForm.value;
    const file = this.selectedFile();
    
    if (!file) {
      this.fileError.set('No file selected');
      return;
    }

    // Update request params to trigger resource loading
    this.requestParams.set({
      file,
      params: {
        language: formValue.language!,
        maxResults: formValue.maxResults!,
        confidenceThreshold: formValue.confidenceThreshold!,
        includeBoundingBoxes: formValue.includeBoundingBoxes!,
        outputFormat: formValue.outputFormat!
      }
    });
  }

  /**
   * Reset the form and clear state
   */
  resetForm(): void {
    this.imageForm.reset({
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
