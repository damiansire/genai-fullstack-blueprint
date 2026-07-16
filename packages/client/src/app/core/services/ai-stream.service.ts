import { Injectable, inject, signal, computed } from '@angular/core';
import { API_CONFIG } from '../tokens/api-config';
import { ModelInvocationResponse } from '../types/api.types';
import {
  createSmoothMessage,
  type SmoothMessageController,
} from '../../../core/streaming/smooth-stream';

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

  /** AbortController for the current stream — allows re-entrant cancellation. */
  private currentController: AbortController | null = null;

  /**
   * Smooth-render controller (P6): raw SSE chunks are enqueued char-by-char and
   * drained on requestAnimationFrame, so `streamText` is updated at most once per
   * frame — never once per raw chunk (the AGENTS.md streaming-render invariant).
   * This also avoids the O(n^2) re-concatenation of updating the signal per chunk.
   */
  private smooth: SmoothMessageController | null = null;

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
    // P9 fix: mirror the non-streaming invoke envelope exactly — `{ data: {
    // result: { text } } }` — so <app-text-model-response> (which reads
    // `data.result.text`) renders streamed text instead of "No text generated".
    return {
      success: true,
      data: { result: { text } },
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

    // Fresh smooth-render controller: drains queued chars on rAF and updates the
    // signal at most once per frame (see field docs).
    this.smooth = createSmoothMessage({
      onTextUpdate: (_delta, fullBuffer) => this.streamText.set(fullBuffer),
    });

    try {
      // Streaming bypasses HttpClient (needs the low-level fetch reader), so the
      // X-API-Key interceptor does NOT run here — add the header manually so the
      // fail-closed gateway does not 401 the stream.
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      };
      if (this.apiConfig.apiKey) {
        headers['X-API-Key'] = this.apiConfig.apiKey;
      }

      const response = await fetch(`${this.apiConfig.baseUrl}/models/${modelId}/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: abortSignal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('Response body is null — server may not support streaming.');
      }

      // Parse the SSE stream chunk by chunk using native Web Streams API.
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();

      // P7 fix: keep a leftover buffer between reads. SSE records are separated
      // by a blank line (`\n\n`); a record can be split across network packets,
      // so we only process COMPLETE records and carry the partial tail forward.
      let buffer = '';

      try {
        while (true) {
          const { value, done } = await reader.read();

          if (abortSignal.aborted) break;

          if (value) buffer += value;

          // Process every complete record (terminated by a blank line).
          let sepIndex: number;
          while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
            const rawRecord = buffer.slice(0, sepIndex);
            buffer = buffer.slice(sepIndex + 2);
            if (this.handleSseRecord(rawRecord)) {
              // [DONE] sentinel (or error frame) — flush remaining queued chars
              // immediately so nothing is stranded, then stop.
              this.smooth?.flushQueue();
              this.isStreaming.set(false);
              return;
            }
          }

          if (done) {
            // Flush any trailing record without a final blank line.
            if (buffer.trim()) this.handleSseRecord(buffer);
            this.smooth?.flushQueue();
            break;
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (err: unknown) {
      // fetch abort rejects with a DOMException, which is not guaranteed to be
      // `instanceof Error` in every realm (e.g. JSDOM/worker realms): detect
      // the intentional cancellation by name, not by prototype chain.
      if ((err as { name?: unknown } | null)?.name === 'AbortError') {
        // Stream was intentionally cancelled — not an error
        return;
      }
      const message = err instanceof Error ? err.message : 'Unknown stream error';
      // Flush whatever was decoded before the failure so partial output is shown.
      this.smooth?.flushQueue();
      this.streamError.set(message);
    } finally {
      this.isStreaming.set(false);
    }
  }

  /**
   * Parses one complete SSE record (a block of `field: value` lines).
   * Honors the `event: error` frames the server emits (rate-limit / failure) so
   * the UI surfaces an error instead of silently rendering nothing.
   *
   * @returns true when the `[DONE]` sentinel was seen (caller should stop).
   */
  private handleSseRecord(record: string): boolean {
    let eventType = 'message';
    const dataLines: string[] = [];

    for (const line of record.split('\n')) {
      if (line.startsWith(':')) continue; // comment / keep-alive noise
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length === 0) return false;
    const dataStr = dataLines.join('\n').trim();

    if (dataStr === '[DONE]') return true;

    if (eventType === 'error') {
      let message = 'Stream error';
      try {
        const parsed = JSON.parse(dataStr) as { message?: string };
        if (parsed.message) message = parsed.message;
      } catch {
        if (dataStr) message = dataStr;
      }
      this.streamError.set(message);
      return true;
    }

    try {
      const parsed = JSON.parse(dataStr) as { text?: string };
      if (parsed.text) {
        // Enqueue the raw chunk into the rAF char-queue instead of touching the
        // signal here — the smooth controller drains it on animation frames and
        // calls onTextUpdate (one signal write per frame at most).
        this.smooth?.pushText(parsed.text);
        this.chunkCount.update((n) => n + 1);
      }
    } catch {
      // Non-JSON data (e.g. metadata frames) — ignore.
    }
    return false;
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
    // Stop the rAF loop without draining the rest of the queue.
    this.smooth?.stopAnimation();
    this.smooth = null;
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
