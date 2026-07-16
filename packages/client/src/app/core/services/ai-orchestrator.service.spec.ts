import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { AiOrchestratorService } from './ai-orchestrator.service';
import { API_CONFIG } from '../tokens/api-config';

const BASE_URL = 'http://gateway.test/api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AiOrchestratorService', () => {
  let service: AiOrchestratorService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: API_CONFIG, useValue: { baseUrl: BASE_URL } },
      ],
    });
    service = TestBed.inject(AiOrchestratorService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('cacheContext', () => {
    it('POSTs the file metadata (with computed sizeBytes) and returns the cache result', async () => {
      const result = {
        cacheId: 'c1',
        fileName: 'doc.md',
        mimeType: 'text/markdown',
        sizeBytes: 4,
        createdAt: 'now',
        action: 'create',
        processingMs: 12,
      };
      fetchMock.mockResolvedValue(jsonResponse(result));

      const out = await service.cacheContext('doc.md', 'text/markdown', 'hola');

      expect(out).toEqual(result);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/domain/context-cache`);
      const body = JSON.parse(init.body as string);
      expect(body.fileName).toBe('doc.md');
      expect(body.mimeType).toBe('text/markdown');
      // sizeBytes is derived from the payload, not trusted from the caller.
      expect(body.sizeBytes).toBe(new Blob(['hola']).size);
    });

    it('throws the server-provided error message on a non-2xx JSON response', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: 'cache full' }, 507));

      await expect(service.cacheContext('f', 'text/plain', 'x')).rejects.toThrow('cache full');
    });

    it('falls back to the HTTP status when the error body is not JSON', async () => {
      fetchMock.mockResolvedValue(new Response('<html>boom</html>', { status: 502 }));

      await expect(service.cacheContext('f', 'text/plain', 'x')).rejects.toThrow('HTTP 502');
    });
  });

  describe('generateCode', () => {
    it('POSTs spec/language/cacheId and echoes the cacheId back into the result', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ language: 'typescript', spec: 's', code: 'c', refinementRounds: 1 }),
      );

      const out = await service.generateCode('s', 'typescript', 'cache-9');

      expect(out.cacheId).toBe('cache-9');
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/domain/code/generate`);
      expect(JSON.parse(init.body as string)).toEqual({
        spec: 's',
        language: 'typescript',
        cacheId: 'cache-9',
      });
    });

    it('throws the server error message when generation fails', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: 'unsupported language' }, 400));

      await expect(service.generateCode('s', 'go')).rejects.toThrow('unsupported language');
    });
  });
});
