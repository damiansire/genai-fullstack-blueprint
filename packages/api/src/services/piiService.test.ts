// Stability: 1 - Experimental (node:test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { piiService, PIIService } from './piiService.js';

describe('PIIService', () => {
  it('redacts an email and round-trips back to the original via unredact', () => {
    const original = 'Contact me at jane.doe@example.com please';
    const { redactedText, mapping } = piiService.redact(original);

    assert.ok(!redactedText.includes('jane.doe@example.com'), 'email must be masked');
    assert.match(redactedText, /<EMAIL:[0-9a-f]{8}>/);
    assert.equal(Object.keys(mapping).length, 1);

    const restored = piiService.unredact(redactedText, mapping);
    assert.equal(restored, original);
  });

  it('produces a deterministic, reversible token for the same input', () => {
    const a = piiService.redact('ssn 123-45-6789');
    const b = piiService.redact('ssn 123-45-6789');
    assert.equal(a.redactedText, b.redactedText, 'token must be deterministic');
    assert.deepEqual(a.mapping, b.mapping);
  });

  it('redacts multiple distinct entities in one pass', () => {
    const original = 'mail a@b.co and id 111-22-3333';
    const { redactedText, mapping } = piiService.redact(original);
    assert.ok(!redactedText.includes('a@b.co'));
    assert.ok(!redactedText.includes('111-22-3333'));
    assert.equal(Object.keys(mapping).length, 2);
    assert.equal(piiService.unredact(redactedText, mapping), original);
  });

  it('is a no-op for empty / non-string input (defensive)', () => {
    assert.deepEqual(piiService.redact(''), { redactedText: '', mapping: {} });
    // @ts-expect-error exercising the runtime guard with a non-string
    assert.deepEqual(piiService.redact(null), { redactedText: null, mapping: {} });
  });

  it('exposes a singleton instance', () => {
    assert.equal(piiService, PIIService.getInstance());
  });
});
