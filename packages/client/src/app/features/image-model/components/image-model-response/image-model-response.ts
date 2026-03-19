import { Component, input, ChangeDetectionStrategy, computed } from '@angular/core';
import { ModelInvocationResponse } from '../../../../core/services/api';

@Component({
  selector: 'app-image-model-response',
  imports: [],
  templateUrl: './image-model-response.html',
  styleUrl: './image-model-response.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ImageModelResponse {
  response = input<ModelInvocationResponse | null>(null);

  // Computed signal for image size
  imageSize = computed(() => {
    const bytes = this.response()?.data?.result?.imageInfo?.size || 0;
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  });
}

