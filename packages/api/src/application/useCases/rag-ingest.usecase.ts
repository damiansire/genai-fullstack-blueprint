import { UseCase } from '../../core/UseCase';
import { logger } from '../../core/logger';
import { ApiError } from '../../core/ApiError';

export interface RAGIngestDTO {
  documentId: string;
  tenantId: string;
  content: string;
  metadata?: Record<string, any>;
}

export interface RAGIngestResult {
  success: boolean;
  documentId: string;
  chunksProcessed: number;
}

/**
 * RAG Ingestion Use Case — NOT IMPLEMENTED.
 *
 * This is a stub. The intended behaviour (semantic chunking → real embeddings →
 * persistence into a `rag_vectors` sqlite-vec table with multi-tenant isolation)
 * is not built:
 *   - there is no real embedding service wired up (the previous code generated a
 *     random buffer, not an embedding);
 *   - the `rag_vectors` table is never created in the schema;
 *   - no rows are ever inserted.
 *
 * Rather than report `success: true` while persisting nothing (silently losing
 * data and faking `chunksProcessed`), this fails loudly with 501 Not Implemented.
 * Chunking is real and kept so the count can be surfaced once persistence lands.
 */
export class RAGIngestUseCase extends UseCase<RAGIngestDTO, RAGIngestResult> {
  protected async executeImpl(input: RAGIngestDTO): Promise<RAGIngestResult> {
    logger.warn(
      `RAG ingestion requested for document ${input.documentId} (tenant ${input.tenantId}) ` +
        `but the feature is not implemented (no embedding service / no rag_vectors persistence).`,
    );

    // Chunking is the only real step; computing it confirms the input is valid
    // and gives an honest count for the error context.
    const chunks = this.chunkText(input.content, 1000);

    throw ApiError.notImplemented(
      `RAG ingestion is not implemented: ${chunks.length} chunk(s) were prepared but ` +
        `no embeddings are generated and nothing is persisted. Implement the embedding ` +
        `service and the rag_vectors table before enabling this endpoint.`,
    );
  }

  private chunkText(text: string, maxLen: number): string[] {
    const chunks: string[] = [];
    let i = 0;
    while (i < text.length) {
      chunks.push(text.slice(i, i + maxLen));
      i += maxLen;
    }
    return chunks;
  }
}
