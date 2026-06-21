// Stability: 1 - Experimental (node:test)
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { OtlpTraceExporter, type FinishedSpan } from './otlp-exporter.js';

const ENV_KEYS = [
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_SERVICE_NAME',
];

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

function sampleSpan(): FinishedSpan {
  return {
    traceId: '123e4567-e89b-12d3-a456-426614174000',
    spanId: 'abcdef01-2345-6789-abcd-ef0123456789',
    name: 'GET /api/models',
    startTimeUnixNano: '1000000000',
    endTimeUnixNano: '2000000000',
    statusCode: 1,
    attributes: { 'http.method': 'GET', 'http.status_code': 200 },
  };
}

describe('OtlpTraceExporter', () => {
  const realFetch = globalThis.fetch;

  beforeEach(clearEnv);
  afterEach(() => {
    clearEnv();
    globalThis.fetch = realFetch;
  });

  it('is disabled (opt-in) when no endpoint env is set — recordSpan is a no-op', async () => {
    const fetchMock = mock.fn(async () => new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const exporter = new OtlpTraceExporter();
    assert.equal(exporter.enabled, false);

    exporter.recordSpan(sampleSpan());
    await exporter.flush();

    assert.equal(fetchMock.mock.callCount(), 0, 'disabled exporter must never POST');
  });

  it('derives /v1/traces from OTEL_EXPORTER_OTLP_ENDPOINT and POSTs OTLP JSON', async () => {
    process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = 'http://collector:4318';
    const fetchMock = mock.fn(async () => new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const exporter = new OtlpTraceExporter();
    assert.equal(exporter.enabled, true);

    exporter.recordSpan(sampleSpan());
    await exporter.flush();

    assert.equal(fetchMock.mock.callCount(), 1);
    const [url, init] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit];
    assert.equal(url, 'http://collector:4318/v1/traces');

    const body = JSON.parse(init.body as string);
    const span = body.resourceSpans[0].scopeSpans[0].spans[0];
    // Trace id normalized to 32 hex chars, span id to 16.
    assert.equal(span.traceId.length, 32);
    assert.equal(span.spanId.length, 16);
    assert.match(span.traceId, /^[0-9a-f]+$/);
    assert.equal(span.name, 'GET /api/models');
    assert.equal(span.status.code, 1);
  });

  it('swallows export failures (graceful degradation, no throw)', async () => {
    process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'] = 'http://down:4318/v1/traces';
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const exporter = new OtlpTraceExporter();
    exporter.recordSpan(sampleSpan());

    // Must not reject even though the collector is unreachable.
    await assert.doesNotReject(() => exporter.flush());
  });
});
