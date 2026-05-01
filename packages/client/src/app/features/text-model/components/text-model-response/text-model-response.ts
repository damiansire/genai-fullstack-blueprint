import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { ModelInvocationResponse } from '../../../../core/services/api';

import { DynamicToolRenderer } from '../../../../shared/components/dynamic-tool-renderer/dynamic-tool-renderer';

@Component({
  selector: 'app-text-model-response',
  imports: [DynamicToolRenderer],
  templateUrl: './text-model-response.html',
  styleUrl: './text-model-response.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TextModelResponse {
  response = input<ModelInvocationResponse | null>(null);
  
  // Unique ID for popover accessibility and targeting
  uniqueId = crypto.randomUUID();

  icons = {
    success: '✅',
    magic: '✨',
    settings: '⚙️',
    info: 'ℹ️',
    close: '✕'
  };
}

