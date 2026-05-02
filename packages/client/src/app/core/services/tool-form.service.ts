/**
 * ToolFormService — Patrón 6: Signal Forms Dinámicos
 *
 * Generates a fully reactive Angular Signal form from a JSON Schema
 * retrieved from the Tool Registry (Patrón 1: GET /api/tools/:name).
 *
 * Design principles:
 *   1. ZERO eval / new Function() — XSS-safe by construction.
 *   2. Pure Signal state — no FormGroup, no ReactiveFormsModule,
 *      no FormsModule. Each field value is an independent Signal<string|number|boolean>.
 *   3. Ordered fields — JSON Schema properties are iterated in insertion order
 *      (ES2015+ spec guarantees string-keyed insertion order for plain objects).
 *   4. httpResource integration — the service can be injected alongside
 *      httpResource() to auto-generate a form when a tool is selected.
 *   5. Graceful degradation — if the schema is malformed or missing, the
 *      service returns null and the component shows a raw JSON fallback.
 *
 * Field → control type mapping:
 *   string (no format)  → text input
 *   string, format:textarea → textarea
 *   string, format:email → email input
 *   string, format:uri  → url input
 *   string, format:date → date input
 *   string, format:password → password input
 *   string, enum: [...]  → select
 *   number / integer    → number input
 *   boolean             → checkbox
 *   array / object      → textarea (JSON string representation)
 */

import { Injectable, signal } from '@angular/core';
import type {
  JsonSchema,
  JsonSchemaProperty,
  DynamicField,
  DynamicToolForm,
  FieldControlType,
} from '../types/tool-form.types';

@Injectable({ providedIn: 'root' })
export class ToolFormService {

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Generates a DynamicToolForm from a JSON Schema object.
   * Returns null if the schema is not a valid `type: "object"` schema.
   *
   * @param toolName        Tool identifier (e.g. 'web_search')
   * @param toolDescription Human-readable description from the Tool Registry
   * @param schema          JSON Schema object from the Tool Registry response
   */
  generateForm(
    toolName: string,
    toolDescription: string,
    schema: unknown
  ): DynamicToolForm | null {
    if (!this.isValidObjectSchema(schema)) {
      return null;
    }

    const typedSchema = schema as JsonSchema;
    const required = new Set(typedSchema.required ?? []);
    const fields: DynamicField[] = [];

    for (const [key, prop] of Object.entries(typedSchema.properties)) {
      fields.push(this.buildField(key, prop, required.has(key)));
    }

    // Initialize a Signal for each field
    const values = new Map(
      fields.map((f) => [key_of(f), signal(f.defaultValue)])
    );

    const snapshot = (): Record<string, string | number | boolean> => {
      const result: Record<string, string | number | boolean> = {};
      for (const field of fields) {
        const sig = values.get(field.key);
        if (sig) result[field.key] = sig();
      }
      return result;
    };

    return { toolName, toolDescription, fields, values, snapshot };
  }

  /**
   * Returns a serialized string representation of the current form values.
   * Useful for displaying the payload that would be sent to the Gateway.
   */
  serializeSnapshot(form: DynamicToolForm): string {
    return JSON.stringify(form.snapshot(), null, 2);
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private isValidObjectSchema(schema: unknown): schema is JsonSchema {
    return (
      typeof schema === 'object' &&
      schema !== null &&
      (schema as any)['type'] === 'object' &&
      typeof (schema as any)['properties'] === 'object'
    );
  }

  private buildField(
    key: string,
    prop: JsonSchemaProperty,
    required: boolean
  ): DynamicField {
    const controlType = this.resolveControlType(prop);
    const defaultValue = this.resolveDefaultValue(prop, controlType);
    const placeholder =
      prop.examples?.[0] !== undefined
        ? String(prop.examples[0])
        : prop.description;

    return {
      key,
      label: toTitleCase(key),
      description: prop.description,
      controlType,
      required,
      defaultValue,
      placeholder,
      options: prop.enum,
      min: prop.minimum,
      max: prop.maximum,
      minLength: prop.minLength,
      maxLength: prop.maxLength,
    };
  }

  private resolveControlType(prop: JsonSchemaProperty): FieldControlType {
    if (prop.type === 'boolean') return 'checkbox';
    if (prop.type === 'number' || prop.type === 'integer') return 'number';
    if (prop.type === 'array' || prop.type === 'object') return 'textarea';
    // string type — check format and enum
    if (prop.enum && prop.enum.length > 0) return 'select';
    switch (prop.format) {
      case 'email':    return 'email';
      case 'uri':      return 'url';
      case 'date':     return 'date';
      case 'time':     return 'time';
      case 'textarea': return 'textarea';
      case 'password': return 'password';
      default:         return 'text';
    }
  }

  private resolveDefaultValue(
    prop: JsonSchemaProperty,
    controlType: FieldControlType
  ): string | number | boolean {
    if (prop.default !== undefined) return prop.default;
    if (controlType === 'checkbox') return false;
    if (controlType === 'number') return prop.minimum ?? 0;
    if (controlType === 'select' && prop.enum?.length) return prop.enum[0] ?? '';
    return '';
  }
}

// ─── Pure utilities ───────────────────────────────────────────────────────────

/** Returns the field's key (alias used in the Map initializer). */
function key_of(field: DynamicField): string {
  return field.key;
}

/**
 * Converts snake_case or camelCase to Title Case.
 *   'max_tokens' → 'Max Tokens'
 *   'modelId'    → 'Model Id'
 */
function toTitleCase(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
