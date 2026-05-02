import { Injectable, inject, signal, computed, linkedSignal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_CONFIG } from '../tokens/api-config';
import { ModelInvocationResponse } from '../types/api.types';

/**
 * Represents a single parsed SSE chunk from the LLM stream.
 */
export interface StreamChunk {
  text: string;
  isDone: boolean;
}

/**
 * The unified state surface exposed to view components.
 * All fields are Signals — no subscriptions, no RxJS, no manual lifecycle.
 */
export interface StreamState {
  /** True while chunks are still arriving. */
  isStreaming: ReturnType<typeof signal<boolean>>;
  /** Accumulated full text so far (progressive). */
  streamText: ReturnType<typeof signal<string>>;
  /** Set when the stream ends with an error. */
  streamError: ReturnType<typeof signal<string | null>>;
  /** Total number of chunks received. */
  chunkCount: ReturnType<typeof signal<number>>;
}

/**
 * AiStreamService — Patrón 4: Declarative SSE Stream via native fetch + Signals
 *
 * Design goals:
 *  1. ZERO RxJS subscriptions — all state is Signal-based.
 *  2. ZERO manual lifecycle management in components — components only read Signals.
 *  3. Progressive rendering: each SSE chunk triggers a micro-Signal update so
 *     Angular's zoneless scheduler re-renders only the text node, not the full tree.
 *  4. Graceful degradation: network errors are captured in `streamError()` Signal;
 *     the UI stays stable and shows a retry option.
 *  5. Re-entrant safe: calling startStream() while a stream is active cancels the
 *     previous one via AbortController before starting the new one.
 */
@Injectable({ providedIn: 'root' })
export class AiStreamService {
  private readonly apiConfig = inject(API_CONFIG);
  // HttpClient is injected but we use native fetch for streaming.
  // HttpClient is kept to participate in the Angular HttpClient interceptor chain
  // for API key headers if needed in the future.
  private readonly http = inject(HttpClient);

  /** AbortController for the current stream — allows re-entrant cancellation. */
  private currentController: AbortController | null = null;

  // ─── Public Signal State ───────────────────────────────────────────────────

  readonly isStreaming = signal(false);
  readonly streamText = signal('');
  readonly streamError = signal<string | null>(null);
  readonly chunkCount = signal(0);

  /**
   * True when at least one character has been received.
   * Drives @defer (when hasStreamContent()) in the template.
   */
  readonly hasStreamContent = computed(() => this.streamText().length > 0);

  /**
   * Wraps the accumulated text as a lightweight ModelInvocationResponse
   * so existing <app-model-response> and <app-text-model-response> components
   * can consume the stream without any modification.
   */
  readonly streamAsResponse = computed<ModelInvocationResponse | null>(() => {
    const text = this.streamText();
    if (!text) return null;
    return {
      success: true,
      data: { text },
      // Metadata is populated after the stream completes (future enhancement)
    };
  });

  // ─── Stream Orchestration ──────────────────────────────────────────────────

  /**
   * Starts a new SSE stream for the given model and payload.
   *
   * Architecture note — why native fetch over HttpClient?
   * Angular's HttpClient materializes the full response body before
   * emitting. For SSE streams we need incremental chunk access via
   * ReadableStream.getReader(), which requires the low-level fetch API.
   * This is intentional and aligns with the "built-in over dependencies"
   * strategy: no @microsoft/fetch-event-source, no ngx-sse-client.
   *
   * @param modelId The model endpoint to invoke (e.g. 'google-text-bison')
   * @param payload The request body forwarded to the AI Gateway
   */
  async startStream(modelId: string, payload: object): Promise<void> {
    // Re-entrant guard: cancel any previous in-flight stream
    this.cancelStream();

    this.currentController = new AbortController();
    const { signal: abortSignal } = this.currentController;

    // Reset state for the new stream
    this.isStreaming.set(true);
    this.streamText.set('');
    this.streamError.set(null);
    this.chunkCount.set(0);

    try {
      const response = await fetch(
        `${this.apiConfig.baseUrl}/models/${modelId}/stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify(payload),
          signal: abortSignal,
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('Response body is null — server may not support streaming.');
      }

      // Parse the SSE stream chunk by chunk using native Web Streams API
      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();

      try {
        while (true) {
          const { value, done } = await reader.read();

          if (done || abortSignal.aborted) break;

          if (!value) continue;

          // An SSE message may contain multiple `data:` lines in one chunk
          for (const line of value.split('\n')) {
            if (!line.startsWith('data: ')) continue;

            const dataStr = line.slice(6).trim(); // Remove 'data: ' prefix

            if (dataStr === '[DONE]') {
              this.isStreaming.set(false);
              return;
            }

            try {
              const parsed = JSON.parse(dataStr) as { text?: string };
              if (parsed.text) {
                // Append the new chunk to the accumulator Signal.
                // Each .update() call schedules a micro-task in Angular's
                // zoneless scheduler — only the text binding re-renders.
                this.streamText.update((prev) => prev + parsed.text);
                this.chunkCount.update((n) => n + 1);
              }
            } catch {
              // Silently ignore incomplete JSON caused by SSE frame splits
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Stream was intentionally cancelled — not an error
        return;
      }
      const message = err instanceof Error ? err.message : 'Unknown stream error';
      this.streamError.set(message);
    } finally {
      this.isStreaming.set(false);
    }
  }

  /**
   * Cancels the current in-flight stream immediately via AbortController.
   * Safe to call even when no stream is active.
   */
  cancelStream(): void {
    if (this.currentController) {
      this.currentController.abort();
      this.currentController = null;
    }
    this.isStreaming.set(false);
  }

  /**
   * Resets all Signal state to initial values.
   * Call before starting a new conversation turn.
   */
  resetStream(): void {
    this.cancelStream();
    this.streamText.set('');
    this.streamError.set(null);
    this.chunkCount.set(0);
  }
}
