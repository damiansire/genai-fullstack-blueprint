import { Component, input, output, ChangeDetectionStrategy, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ModelInvocationResponse } from '../../../core/services/api';

/**
 * ModelResponse — Shared presentation component for AI responses.
 *
 * Patrón 4 extension: accepts `isStreaming` and `streamText` inputs so
 * it can render a progressive live text view with a native CSS cursor
 * animation while the SSE stream is active — without any JS animation loop.
 *
 * States:
 *   1. LOADING (spinner)   — isLoading=true, no response yet
 *   2. STREAMING (live)    — isStreaming=true, progressive streamText
 *   3. COMPLETE (response) — isStreaming=false, response is populated
 *   4. ERROR               — error string is set
 */
@Component({
  selector: 'app-model-response',
  imports: [DatePipe],
  templateUrl: './model-response.html',
  styleUrl: './model-response.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-processing-status]': 'processingStatus()',
    '[attr.data-streaming]': 'isStreaming()',
  },
})
export class ModelResponse {
  // ─── Existing inputs ───────────────────────────────────────────────────────
  loading = input(false);
  error = input<string | null>(null);
  response = input<ModelInvocationResponse | null>(null);
  loadingMessage = input('Processing...');

  // ─── Patrón 4: new streaming inputs ────────────────────────────────────────
  /** True while SSE chunks are still arriving from AiStreamService. */
  isStreaming = input(false);
  /**
   * The progressively accumulated text from AiStreamService.streamText().
   * Rendered directly in the streaming state — avoids a full re-render of
   * <app-text-model-response> on every chunk.
   */
  streamText = input('');

  retry = output<void>();

  // ─── Derived state ─────────────────────────────────────────────────────────

  processingStatus = computed(() => {
    if (this.isStreaming()) return 'streaming';
    if (this.loading()) return 'activo';
    if (this.response()) return 'completado';
    return 'esperando';
  });

  icons = {
    error: '❌',
    retry: '🔄',
  };
}
