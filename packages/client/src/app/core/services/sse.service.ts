import { Injectable, inject } from '@angular/core';
import { API_CONFIG } from '../tokens/api-config';

export interface SseChunk {
  text: string;
  isDone: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class SseService {
  private apiConfig = inject(API_CONFIG);

  /**
   * Consumes an SSE stream and yields parsed text chunks progressively.
   * Utilizes native Web Streams API for high performance processing without dependencies.
   */
  public async *streamModelResponse(modelId: string, payload: any): AsyncGenerator<SseChunk> {
    const response = await fetch(`${this.apiConfig.baseUrl}/models/${modelId}/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify(payload)
    });

    if (!response.body) {
      throw new Error('No readable stream available in response.');
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();

    try {
      while (true) {
        const { value, done } = await reader.read();
        
        if (done) {
          yield { text: '', isDone: true };
          break;
        }

        // Parse SSE text format ("data: ...\n\n")
        if (value) {
          const lines = value.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.replace('data: ', '').trim();
              if (dataStr === '[DONE]') {
                yield { text: '', isDone: true };
                return;
              }
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.text) {
                  yield { text: parsed.text, isDone: false };
                }
              } catch (e) {
                // Ignore incomplete JSON chunks from SSE fragmentation natively
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
