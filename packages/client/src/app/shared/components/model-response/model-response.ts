import { Component, input, output, ChangeDetectionStrategy, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ModelInvocationResponse } from '../../../core/services/api';

@Component({
  selector: 'app-model-response',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './model-response.html',
  styleUrl: './model-response.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-processing-status]': 'processingStatus()'
  }
})
export class ModelResponse {
  loading = input(false);
  error = input<string | null>(null);
  response = input<ModelInvocationResponse | null>(null);
  loadingMessage = input('Processing...');

  retry = output<void>();

  processingStatus = computed(() => this.loading() ? 'activo' : (this.response() ? 'completado' : 'esperando'));

  icons = {
    error: '❌',
    retry: '🔄'
  };
}

