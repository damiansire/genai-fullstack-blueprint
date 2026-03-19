import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ModelInvocationResponse } from '../../../core/services/api';

@Component({
  selector: 'app-model-response',
  imports: [DatePipe],
  templateUrl: './model-response.html',
  styleUrl: './model-response.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ModelResponse {
  loading = input(false);
  error = input<string | null>(null);
  response = input<ModelInvocationResponse | null>(null);
  loadingMessage = input('Processing...');
}

