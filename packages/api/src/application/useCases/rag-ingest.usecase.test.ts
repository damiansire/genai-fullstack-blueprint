// Stability: 1 - Experimental (node:test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RAGIngestUseCase } from './rag-ingest.usecase.js';
import { ApiError } from '../../core/ApiError.js';

describe('RAGIngestUseCase', () => {
  it('fails with 501 Not Implemented instead of faking success', async () => {
    const useCase = new RAGIngestUseCase();

    await assert.rejects(
      () =>
        useCase.execute({
          documentId: 'doc-1',
          tenantId: 'tenant-1',
          content: 'a'.repeat(2500), // 3 chunks at maxLen 1000
        }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError, 'should throw an ApiError');
        assert.equal(err.statusCode, 501);
        assert.match(err.message, /not implemented/i);
        assert.match(err.message, /3 chunk/); // honest chunk count, nothing persisted
        return true;
      },
    );
  });
});
