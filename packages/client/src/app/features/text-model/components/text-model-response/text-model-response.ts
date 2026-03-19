import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { ModelInvocationResponse } from '../../../../core/services/api';

@Component({
  selector: 'app-text-model-response',
  imports: [],
  templateUrl: './text-model-response.html',
  styleUrl: './text-model-response.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TextModelResponse {
  response = input<ModelInvocationResponse | null>(null);
}

