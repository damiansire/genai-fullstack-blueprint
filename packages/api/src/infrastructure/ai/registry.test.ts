// Stability: 1 - Experimental (node:test)
import { describe, it, beforeEach } from 'node:test';
// Stability: 2 - Stable (node:assert/strict)
import assert from 'node:assert/strict';
import { SchemaRegistry } from './registry.js';

describe('SchemaRegistry', () => {
  let registry: SchemaRegistry;

  beforeEach(() => {
    registry = new SchemaRegistry();
  });

  it('should register and retrieve a schema', () => {
    const mockSchema = { type: 'object', properties: { id: { type: 'string' } } };
    registry.register('test-model', mockSchema);

    assert.equal(registry.hasSchema('test-model'), true);
    assert.deepEqual(registry.getSchema('test-model'), mockSchema);
  });

  it('should throw when registering a duplicate modelId', () => {
    registry.register('test-model', {});
    assert.throws(() => registry.register('test-model', {}), {
      message: "Schema for model ID 'test-model' is already registered",
    });
  });

  it('should throw when getting a non-existent schema', () => {
    assert.throws(() => registry.getSchema('unknown-model'), {
      message: "Schema for model ID 'unknown-model' is not registered",
    });
  });

  it('should unregister a schema correctly', () => {
    registry.register('test-model', {});
    assert.equal(registry.size(), 1);

    const result = registry.unregister('test-model');
    assert.equal(result, true);
    assert.equal(registry.size(), 0);
    assert.equal(registry.hasSchema('test-model'), false);
  });

  it('should clear all schemas', () => {
    registry.register('model1', {});
    registry.register('model2', {});
    assert.equal(registry.size(), 2);

    registry.clear();
    assert.equal(registry.size(), 0);
  });
});
