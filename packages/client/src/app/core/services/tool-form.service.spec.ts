import { describe, it, expect, beforeEach } from 'vitest';
import { ToolFormService } from './tool-form.service';
import type { JsonSchema } from '../types/tool-form.types';

/**
 * ToolFormService is pure domain logic (JSON Schema -> Signal form descriptor):
 * no HTTP, no DOM, no injection context needed, so it is exercised directly.
 */
describe('ToolFormService', () => {
  let service: ToolFormService;

  beforeEach(() => {
    service = new ToolFormService();
  });

  describe('schema validation (graceful degradation)', () => {
    it('returns null for a non-object schema', () => {
      expect(service.generateForm('t', 'd', 'not-a-schema')).toBeNull();
      expect(service.generateForm('t', 'd', 42)).toBeNull();
      expect(service.generateForm('t', 'd', null)).toBeNull();
      expect(service.generateForm('t', 'd', undefined)).toBeNull();
    });

    it('returns null when type is not "object" or properties is missing', () => {
      expect(service.generateForm('t', 'd', { type: 'string' })).toBeNull();
      expect(service.generateForm('t', 'd', { type: 'object' })).toBeNull();
    });
  });

  describe('field generation', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query', minLength: 1, maxLength: 200 },
        max_results: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        safe_search: { type: 'boolean' },
        region: { type: 'string', enum: ['us', 'eu', 'latam'] },
        notes: { type: 'string', format: 'textarea' },
        contact: { type: 'string', format: 'email' },
        homepage: { type: 'string', format: 'uri' },
        secret: { type: 'string', format: 'password' },
        when: { type: 'string', format: 'date' },
        tags: { type: 'array' as const },
      },
      required: ['query'],
    };

    it('maps every JSON Schema type/format to the right control type', () => {
      const form = service.generateForm('web_search', 'Searches the web', schema);
      expect(form).not.toBeNull();
      const byKey = new Map(form!.fields.map((f) => [f.key, f]));
      expect(byKey.get('query')!.controlType).toBe('text');
      expect(byKey.get('max_results')!.controlType).toBe('number');
      expect(byKey.get('safe_search')!.controlType).toBe('checkbox');
      expect(byKey.get('region')!.controlType).toBe('select');
      expect(byKey.get('notes')!.controlType).toBe('textarea');
      expect(byKey.get('contact')!.controlType).toBe('email');
      expect(byKey.get('homepage')!.controlType).toBe('url');
      expect(byKey.get('secret')!.controlType).toBe('password');
      expect(byKey.get('when')!.controlType).toBe('date');
      // array/object payloads degrade to a JSON textarea
      expect(byKey.get('tags')!.controlType).toBe('textarea');
    });

    it('preserves schema property order (rendering order contract)', () => {
      const form = service.generateForm('web_search', 'd', schema)!;
      expect(form.fields.map((f) => f.key)).toEqual([
        'query',
        'max_results',
        'safe_search',
        'region',
        'notes',
        'contact',
        'homepage',
        'secret',
        'when',
        'tags',
      ]);
    });

    it('marks only the schema-required fields as required', () => {
      const form = service.generateForm('web_search', 'd', schema)!;
      const byKey = new Map(form.fields.map((f) => [f.key, f]));
      expect(byKey.get('query')!.required).toBe(true);
      expect(byKey.get('max_results')!.required).toBe(false);
    });

    it('derives Title Case labels from snake_case and camelCase keys', () => {
      const form = service.generateForm('t', 'd', {
        type: 'object',
        properties: {
          max_tokens: { type: 'number' },
          modelId: { type: 'string' },
        },
      })!;
      const byKey = new Map(form.fields.map((f) => [f.key, f]));
      expect(byKey.get('max_tokens')!.label).toBe('Max Tokens');
      expect(byKey.get('modelId')!.label).toBe('Model Id');
    });

    it('resolves default values: explicit default > type default > minimum for numbers', () => {
      const form = service.generateForm('t', 'd', {
        type: 'object',
        properties: {
          count: { type: 'integer', minimum: 5 },
          explicit: { type: 'integer', default: 42 },
          flag: { type: 'boolean' },
          pick: { type: 'string', enum: ['a', 'b'] },
          free: { type: 'string' },
        },
      })!;
      const byKey = new Map(form.fields.map((f) => [f.key, f]));
      expect(byKey.get('count')!.defaultValue).toBe(5);
      expect(byKey.get('explicit')!.defaultValue).toBe(42);
      expect(byKey.get('flag')!.defaultValue).toBe(false);
      expect(byKey.get('pick')!.defaultValue).toBe('a');
      expect(byKey.get('free')!.defaultValue).toBe('');
    });

    it('uses examples[0] as placeholder, falling back to the description', () => {
      const form = service.generateForm('t', 'd', {
        type: 'object',
        properties: {
          a: { type: 'string', examples: ['try me'], description: 'ignored' },
          b: { type: 'string', description: 'fallback text' },
        },
      })!;
      const byKey = new Map(form.fields.map((f) => [f.key, f]));
      expect(byKey.get('a')!.placeholder).toBe('try me');
      expect(byKey.get('b')!.placeholder).toBe('fallback text');
    });
  });

  describe('signal value store and snapshot', () => {
    it('initializes one Signal per field and snapshots current values', () => {
      const form = service.generateForm('t', 'd', {
        type: 'object',
        properties: {
          q: { type: 'string', default: 'hi' },
          n: { type: 'integer', default: 3 },
        },
      })!;
      expect(form.snapshot()).toEqual({ q: 'hi', n: 3 });

      form.values.get('q')!.set('updated');
      expect(form.snapshot()).toEqual({ q: 'updated', n: 3 });
    });

    it('serializeSnapshot produces pretty-printed JSON of the live values', () => {
      const form = service.generateForm('t', 'd', {
        type: 'object',
        properties: { q: { type: 'string', default: 'x' } },
      })!;
      expect(JSON.parse(service.serializeSnapshot(form))).toEqual({ q: 'x' });
    });
  });
});
