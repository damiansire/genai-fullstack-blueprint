/**
 * DynamicToolForm — Patrón 6: Signal Forms Dinámicos
 *
 * Renders a fully reactive form generated at runtime from a JSON Schema.
 * Each field is backed by an independent Signal — no FormGroup, no RxJS.
 *
 * Lifecycle:
 *   1. Parent passes `toolName` input (e.g. 'web_search')
 *   2. Component fetches the tool schema from GET /api/tools/:name (httpResource)
 *   3. ToolFormService.generateForm() creates DynamicToolForm with Signal values
 *   4. Template @for iterates fields, rendering the appropriate control type
 *   5. On submit: form.snapshot() collects all Signal values → parent receives DTO
 *
 * XSS Safety:
 *   - Field keys are used only as `id` attributes and Map keys (plain strings)
 *   - Field values are bound with `[value]` (not innerHTML or [innerHtml])
 *   - No new Function(), no eval(), no template compilation at runtime
 *   - NgComponentOutlet is NOT used here (schema drives standard HTML controls only)
 *
 * Accessibility:
 *   - Each control has a linked <label for="...">
 *   - Error messages use role="alert" aria-live="polite"
 *   - Required fields have aria-required="true"
 *   - Checkbox uses role="checkbox" with aria-checked binding
 */

import {
  Component,
  input,
  output,
  inject,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import { httpResource } from '@angular/common/http';
import { API_CONFIG } from '../../../core/tokens/api-config';
import { ToolFormService } from '../../../core/services/tool-form.service';
import type { DynamicToolForm, DynamicField } from '../../../core/types/tool-form.types';

@Component({
  selector: 'app-dynamic-tool-form',
  imports: [],
  templateUrl: './dynamic-tool-form.html',
  styleUrl: './dynamic-tool-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-tool]': 'toolName()',
    '[attr.data-form-state]': 'formState()',
  },
})
export class DynamicToolFormComponent {
  private readonly apiConfig = inject(API_CONFIG);
  private readonly toolFormService = inject(ToolFormService);

  // ─── Inputs / Outputs ─────────────────────────────────────────────────────

  /** The tool name to load from the Tool Registry (e.g. 'web_search'). */
  toolName = input.required<string>();

  /** Emitted when the user submits the form. Payload is the snapshot DTO. */
  toolSubmit = output<Record<string, string | number | boolean>>();

  /** Emitted when the user cancels. */
  toolCancel = output<void>();

  // ─── Remote schema fetch (Patrón 1 integration) ───────────────────────────

  /**
   * httpResource reactively fetches the tool schema whenever toolName() changes.
   * Caches the response — repeated renders for the same tool name cost zero requests.
   */
  protected readonly toolResource = httpResource<{
    name: string;
    description: string;
    schema: unknown;
    category: string;
  }>(() => ({
    url: `${this.apiConfig.baseUrl}/tools/${this.toolName()}`,
    method: 'GET',
  }));

  // ─── Signal Form generation ────────────────────────────────────────────────

  /**
   * The generated DynamicToolForm, or null while loading/on error.
   * Computed from the tool schema — re-generates whenever the tool changes.
   */
  readonly dynamicForm = computed<DynamicToolForm | null>(() => {
    const toolData = this.toolResource.value();
    if (!toolData) return null;
    return this.toolFormService.generateForm(
      toolData.name,
      toolData.description,
      toolData.schema
    );
  });

  // ─── View state ───────────────────────────────────────────────────────────

  readonly isLoading = computed(() => this.toolResource.isLoading());
  readonly loadError = computed(() => this.toolResource.error()?.message ?? null);

  /** Current submission state for button feedback. */
  readonly isSubmitting = signal(false);

  readonly formState = computed(() => {
    if (this.isLoading()) return 'loading';
    if (this.loadError()) return 'error';
    if (!this.dynamicForm()) return 'empty';
    return 'ready';
  });

  // ─── Payload preview ──────────────────────────────────────────────────────

  /** Live JSON preview of the current field values — updated on every keystroke. */
  readonly payloadPreview = computed(() => {
    const form = this.dynamicForm();
    if (!form) return '';
    return this.toolFormService.serializeSnapshot(form);
  });

  /** Track whether the preview panel is expanded. */
  readonly showPreview = signal(false);

  // ─── Field helpers (exposed to template) ──────────────────────────────────

  /**
   * Gets the current Signal value for a field.
   * The Signal is stored in DynamicToolForm.values Map.
   */
  getFieldValue(form: DynamicToolForm, field: DynamicField): string | number | boolean {
    return form.values.get(field.key)?.() ?? field.defaultValue;
  }

  /**
   * Updates the Signal value for a field from an input event.
   * Handles type coercion: checkbox → boolean, number → number, rest → string.
   */
  setFieldValue(form: DynamicToolForm, field: DynamicField, event: Event): void {
    const sig = form.values.get(field.key);
    if (!sig) return;

    const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

    if (field.controlType === 'checkbox') {
      sig.set((target as HTMLInputElement).checked);
    } else if (field.controlType === 'number') {
      const parsed = parseFloat((target as HTMLInputElement).value);
      sig.set(isNaN(parsed) ? 0 : parsed);
    } else {
      sig.set(target.value);
    }
  }

  /**
   * Returns true if a required field currently has an empty/falsy value.
   * Used for inline validation feedback.
   */
  isFieldInvalid(form: DynamicToolForm, field: DynamicField): boolean {
    if (!field.required) return false;
    const val = form.values.get(field.key)?.();
    if (val === undefined || val === null) return true;
    if (typeof val === 'string') return val.trim().length === 0;
    return false;
  }

  // ─── Form submission ──────────────────────────────────────────────────────

  onSubmit(form: DynamicToolForm): void {
    // Validate all required fields
    const hasEmptyRequired = form.fields.some((f: DynamicField) => this.isFieldInvalid(form, f));
    if (hasEmptyRequired) return;

    this.isSubmitting.set(true);
    const dto = form.snapshot();
    this.toolSubmit.emit(dto);
    // Parent resets isSubmitting via toolName change or explicit call
    setTimeout(() => this.isSubmitting.set(false), 300);
  }

  onCancel(): void {
    this.toolCancel.emit();
  }

  togglePreview(): void {
    this.showPreview.update((v) => !v);
  }

  /** Track @for by field key for efficient DOM reuse. */
  trackByKey(_: number, field: DynamicField): string {
    return field.key;
  }
}
