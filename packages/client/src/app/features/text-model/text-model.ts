import {
  Component,
  signal,
  inject,
  ChangeDetectionStrategy,
  computed,
  OnDestroy,
} from '@angular/core';
import { form, submit, required, minLength, maxLength, min, max } from '@angular/forms/signals';
import { httpResource } from '@angular/common/http';
import { ModelInvocationResponse } from '../../core/services/api';
import { API_CONFIG } from '../../core/tokens/api-config';
import { AiStreamService } from '../../core/services/ai-stream.service';
import { TextModelForm } from './components/text-model-form/text-model-form';
import { TextModelResponse } from './components/text-model-response/text-model-response';
import { ModelResponse } from '../../shared/components/model-response/model-response';

/**
 * TextModel — Patrón 4: Declarative SSE Stream via AiStreamService + Signals
 *
 * Before (imperative):
 *   - Manual `isStreaming` flag
 *   - Manual `streamTrigger` to reset `linkedSignal`
 *   - `for await` loop in `onSubmit()` imperative handler
 *   - Manual `try/catch/finally` for error and cleanup
 *   - SseService injected and called directly in the component
 *
 * After (declarative):
 *   - Component reads Signals from AiStreamService (isStreaming, streamText, error)
 *   - `onSubmit()` calls `aiStream.startStream()` — ONE line of business logic
 *   - `httpResource` handles the non-streaming (exact-match cache) path
 *   - Template is fully reactive: @defer, @if, all driven by Signals
 *   - OnDestroy cancels any active stream (AbortController) automatically
 */
@Component({
  selector: 'app-text-model',
  standalone: true,
  imports: [TextModelForm, TextModelResponse, ModelResponse],
  templateUrl: './text-model.html',
  styleUrl: './text-model.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TextModel implements OnDestroy {
  private readonly apiConfig = inject(API_CONFIG);
  readonly aiStream = inject(AiStreamService);

  icons = { robot: '🤖' };

  // ─── Form State ────────────────────────────────────────────────────────────

  textModel = signal({
    prompt: '',
    maxTokens: 256,
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
  });

  textForm = form(this.textModel, (s) => {
    required(s.prompt, { message: 'Prompt is required' });
    minLength(s.prompt, 1);
    maxLength(s.prompt, 8192, { message: 'Prompt must not exceed 8192 characters' });
    min(s.maxTokens, 1, { message: 'Max Tokens must be at least 1' });
    max(s.maxTokens, 1024, { message: 'Max Tokens must not exceed 1024' });
    min(s.temperature, 0, { message: 'Temperature must be at least 0' });
    max(s.temperature, 1, { message: 'Temperature must not exceed 1' });
    min(s.topP, 0, { message: 'Top P must be at least 0' });
    max(s.topP, 1, { message: 'Top P must not exceed 1' });
    min(s.topK, 1, { message: 'Top K must be at least 1' });
    max(s.topK, 100, { message: 'Top K must not exceed 100' });
  });

  // ─── Non-streaming httpResource (cache-first path) ─────────────────────────
  // Triggered only when stream is explicitly disabled.
  // In the current flow, stream is always true, so this acts as a fallback.
  requestParams = signal<
    | { prompt: string; maxTokens: number; temperature: number; topP: number; topK: number }
    | undefined
  >(undefined);

  textModelResource = httpResource<ModelInvocationResponse>(() => {
    const params = this.requestParams();
    if (!params) return undefined;
    return {
      url: `${this.apiConfig.baseUrl}/models/google-text-bison/invoke`,
      method: 'POST',
      body: params,
      headers: { 'Content-Type': 'application/json' },
    };
  });

  // ─── Unified Response Signal ───────────────────────────────────────────────
  // Merges the streaming response with the httpResource response into a single
  // Signal that <app-model-response> and <app-text-model-response> consume.
  // Priority: stream > httpResource (stream is always preferred for UX).
  readonly activeResponse = computed<ModelInvocationResponse | null>(() => {
    return (
      this.aiStream.streamAsResponse() ??
      this.textModelResource.value() ??
      null
    );
  });

  // True if either the stream or the httpResource is active
  readonly isLoading = computed(
    () => this.aiStream.isStreaming() || this.textModelResource.isLoading()
  );

  // Unified error from either source
  readonly activeError = computed<string | null>(
    () =>
      this.aiStream.streamError() ??
      this.textModelResource.error()?.message ??
      null
  );

  // ─── @defer trigger: show the response panel when any data arrives ──────────
  readonly shouldShowResponse = computed(
    () =>
      this.isLoading() ||
      this.aiStream.hasStreamContent() ||
      this.textModelResource.hasValue() ||
      !!this.activeError()
  );

  // ─── Actions ───────────────────────────────────────────────────────────────

  onSubmit(): void {
    submit(this.textForm, async () => {
      const model = this.textModel();
      const payload = {
        prompt: model.prompt,
        maxTokens: model.maxTokens,
        temperature: model.temperature,
        topP: model.topP,
        topK: model.topK,
      };

      // Patrón 4: single declarative call
      this.aiStream.startStream('google-text-bison', { ...payload, stream: true });
    });
  }

  resetForm(): void {
    this.textModel.set({
      prompt: '',
      maxTokens: 256,
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
    });
    this.requestParams.set(undefined);
    // Resets all stream Signals and cancels any active fetch via AbortController
    this.aiStream.resetStream();
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  ngOnDestroy(): void {
    // Cancel any in-flight stream when the component is destroyed
    // (e.g. route navigation away from the page)
    this.aiStream.cancelStream();
  }
}
