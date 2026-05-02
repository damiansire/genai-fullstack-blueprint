/**
 * Tool Form Types — Patrón 6: Signal Forms Dinámicos
 *
 * These types form the bridge between a JSON Schema (from the Tool Registry API,
 * Patrón 1) and an Angular Signal-based form. The type system is intentionally
 * narrow: it only supports the JSON Schema subset that tool definitions use.
 *
 * XSS Safety: ALL values are treated as plain data (string/number/boolean).
 * No `new Function()`, no `eval()`, no `innerHTML`. The form renders only
 * standard HTML form controls with `[value]` bindings.
 */

// ─── JSON Schema subset supported by the tool form generator ─────────────────

export type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';

export interface JsonSchemaProperty {
  type: JsonSchemaType;
  description?: string;
  /** For string fields — controls which HTML input type is rendered. */
  format?: 'email' | 'uri' | 'date' | 'time' | 'textarea' | 'password';
  /** For number/integer fields. */
  minimum?: number;
  maximum?: number;
  /** For string fields. */
  minLength?: number;
  maxLength?: number;
  /** For string fields — renders a <select> instead of <input>. */
  enum?: string[];
  /** Default value shown in the field. */
  default?: string | number | boolean;
  /** Example value shown as placeholder. */
  examples?: Array<string | number>;
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

// ─── Runtime field descriptor — one per form control ─────────────────────────

export type FieldControlType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'email'
  | 'url'
  | 'password'
  | 'date'
  | 'time'
  | 'checkbox'
  | 'select';

export interface DynamicField {
  /** JSON Schema property key — used as the form control name. */
  key: string;
  /** Human-readable label derived from the key (snake_case → Title Case). */
  label: string;
  /** Description from the JSON Schema, shown as hint text. */
  description?: string;
  /** HTML input type or special control type. */
  controlType: FieldControlType;
  /** Whether the field is listed in the schema's `required` array. */
  required: boolean;
  /** Initial value (from `default`) — Signal is initialized with this. */
  defaultValue: string | number | boolean;
  /** Placeholder text derived from `examples[0]` or description. */
  placeholder?: string;
  /** For `select` controls — the allowed values. */
  options?: string[];
  // Validation constraints (passed to the Signal form)
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
}

// ─── The generated form surface ───────────────────────────────────────────────

/**
 * A DynamicToolForm is the runtime output of ToolFormService.generateForm().
 * It holds the ordered field descriptors and a Signal Map of current values.
 * The component reads both to render and submit the form.
 */
export interface DynamicToolForm {
  /** Tool identifier (e.g. 'web_search'). */
  toolName: string;
  /** Tool description shown as form header. */
  toolDescription: string;
  /** Ordered list of field descriptors for rendering. */
  fields: DynamicField[];
  /** Signal-based value store: key → current field value. */
  values: Map<string, ReturnType<typeof import('@angular/core').signal<string | number | boolean>>>;
  /**
   * Collects all current values into a plain object for submission.
   * Called by the parent component on form submit.
   */
  snapshot: () => Record<string, string | number | boolean>;
}
