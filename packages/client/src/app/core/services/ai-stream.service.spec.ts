import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { AiStreamService } from './ai-stream.service';
import { API_CONFIG, type ApiConfig } from '../tokens/api-config';

const BASE_URL = 'http://gateway.test/api';

/** Builds a Response whose body streams the given SSE payload chunks. */
function sseResponse(chunks: string[], init?: { neverClose?: boolean }): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (!init?.neverClose) controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function configureService(config: Partial<ApiConfig> = {}): AiStreamService {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: API_CONFIG, useValue: { baseUrl: BASE_URL, ...config } },
    ],
  });
  return TestBed.inject(AiStreamService);
}

describe('AiStreamService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('SSE parsing', () => {
    it('accumulates data records and stops on the [DONE] sentinel', async () => {
      fetchMock.mockResolvedValue(
        sseResponse([
          'data: {"text":"Hello"}\n\n',
          'data: {"text":" world"}\n\n',
          'data: [DONE]\n\n',
        ]),
      );
      const service = configureService({ apiKey: 'k' });

      await service.startStream('google-text-bison', { prompt: 'hi' });

      expect(service.streamText()).toBe('Hello world');
      expect(service.chunkCount()).toBe(2);
      expect(service.isStreaming()).toBe(false);
      expect(service.streamError()).toBeNull();
    });

    it('reassembles SSE records split across network packets (partial buffering)', async () => {
      // One logical record delivered in three ragged chunks, then [DONE] glued
      // to the tail of the previous packet: the exact case the leftover-buffer
      // logic exists for.
      fetchMock.mockResolvedValue(
        sseResponse(['data: {"te', 'xt":"partes"}', '\n\ndata: [DO', 'NE]\n\n']),
      );
      const service = configureService();

      await service.startStream('google-text-bison', {});

      expect(service.streamText()).toBe('partes');
      expect(service.chunkCount()).toBe(1);
      expect(service.streamError()).toBeNull();
    });

    it('ignores SSE comment/keep-alive lines and non-JSON data frames', async () => {
      fetchMock.mockResolvedValue(
        sseResponse([
          ': keep-alive\n\n',
          'data: not-json-metadata\n\n',
          'data: {"text":"ok"}\n\n',
          'data: [DONE]\n\n',
        ]),
      );
      const service = configureService();

      await service.startStream('m', {});

      expect(service.streamText()).toBe('ok');
      expect(service.chunkCount()).toBe(1);
    });

    it('flushes a trailing record even when the stream ends without a final blank line', async () => {
      fetchMock.mockResolvedValue(sseResponse(['data: {"text":"tail"}']));
      const service = configureService();

      await service.startStream('m', {});

      expect(service.streamText()).toBe('tail');
    });
  });

  describe('error handling', () => {
    it('surfaces server `event: error` frames (rate-limit / provider failure) in streamError', async () => {
      fetchMock.mockResolvedValue(
        sseResponse([
          'data: {"text":"partial"}\n\n',
          'event: error\ndata: {"message":"Rate limit exceeded"}\n\n',
        ]),
      );
      const service = configureService();

      await service.startStream('m', {});

      expect(service.streamError()).toBe('Rate limit exceeded');
      expect(service.isStreaming()).toBe(false);
      // Text received before the failure is preserved for the UI.
      expect(service.streamText()).toBe('partial');
    });

    it('falls back to the raw data string when an error frame is not JSON', async () => {
      fetchMock.mockResolvedValue(sseResponse(['event: error\ndata: upstream exploded\n\n']));
      const service = configureService();

      await service.startStream('m', {});

      expect(service.streamError()).toBe('upstream exploded');
    });

    it('sets streamError on a non-2xx HTTP response', async () => {
      fetchMock.mockResolvedValue(new Response('nope', { status: 503, statusText: 'Unavailable' }));
      const service = configureService();

      await service.startStream('m', {});

      expect(service.streamError()).toContain('HTTP 503');
      expect(service.isStreaming()).toBe(false);
    });

    it('sets streamError when the network request itself rejects', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      const service = configureService();

      await service.startStream('m', {});

      expect(service.streamError()).toBe('Failed to fetch');
      expect(service.isStreaming()).toBe(false);
    });
  });

  describe('cancellation and reset', () => {
    it('cancelStream aborts without recording an error (user intent, not failure)', async () => {
      fetchMock.mockImplementation((_url: string, init: RequestInit) => {
        const signal = init.signal as AbortSignal;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"text":"first"}\n\n'));
            // Never closes (simulates a long-lived stream); wire the abort
            // signal so reader.read() rejects like real fetch would.
            signal.addEventListener('abort', () => {
              controller.error(new DOMException('The user aborted a request.', 'AbortError'));
            });
          },
        });
        return Promise.resolve(new Response(stream, { status: 200 }));
      });
      const service = configureService();

      const streaming = service.startStream('m', {});
      // Yield so the first chunk is consumed before cancelling.
      await new Promise((resolve) => setTimeout(resolve, 10));
      service.cancelStream();
      await streaming;

      expect(service.isStreaming()).toBe(false);
      expect(service.streamError()).toBeNull();
    });

    it('resetStream clears all signal state', async () => {
      fetchMock.mockResolvedValue(sseResponse(['data: {"text":"x"}\n\n', 'data: [DONE]\n\n']));
      const service = configureService();
      await service.startStream('m', {});
      expect(service.streamText()).toBe('x');

      service.resetStream();

      expect(service.streamText()).toBe('');
      expect(service.streamError()).toBeNull();
      expect(service.chunkCount()).toBe(0);
      expect(service.hasStreamContent()).toBe(false);
    });
  });

  describe('gateway contract', () => {
    it('POSTs to /models/:id/stream with the X-API-Key header when a key is configured', async () => {
      fetchMock.mockResolvedValue(sseResponse(['data: [DONE]\n\n']));
      const service = configureService({ apiKey: 'secret-key' });

      await service.startStream('gemini-image-gen', { prompt: 'p' });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/models/gemini-image-gen/stream`);
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['X-API-Key']).toBe('secret-key');
      expect(JSON.parse(init.body as string)).toEqual({ prompt: 'p' });
    });

    it('omits the X-API-Key header when no key is configured', async () => {
      fetchMock.mockResolvedValue(sseResponse(['data: [DONE]\n\n']));
      const service = configureService();

      await service.startStream('m', {});

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)['X-API-Key']).toBeUndefined();
    });

    it('streamAsResponse mirrors the non-streaming invoke envelope ({ data: { result: { text } } })', async () => {
      fetchMock.mockResolvedValue(
        sseResponse(['data: {"text":"enveloped"}\n\n', 'data: [DONE]\n\n']),
      );
      const service = configureService();

      await service.startStream('m', {});

      expect(service.streamAsResponse()).toEqual({
        success: true,
        data: { result: { text: 'enveloped' } },
      });
    });

    it('streamAsResponse is null before any text arrives', () => {
      const service = configureService();
      expect(service.streamAsResponse()).toBeNull();
    });
  });
});
