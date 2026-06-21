// Stability: 1 - Experimental (node:test)
//
// E2E for the OTLP exporter. Unlike otlp-exporter.test.ts (which mocks `fetch`),
// this exercises the REAL export path against a REAL collector: it spawns an
// actual `node:http` collector in a CHILD PROCESS (otlp-collector.fixture.mjs),
// points the exporter at it via env, records a span, flushes through native
// `fetch` over loopback, and asserts the collector genuinely received a
// well-formed OTLP/HTTP-JSON payload.
//
// The collector runs out-of-process on purpose: it keeps the real socket
// lifecycle off the test runner's loop, so `--test-force-exit` (required by this
// repo's gate) cannot force-close a live in-process socket — which trips a libuv
// close assertion on Windows.
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
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

interface ReceivedRequest {
  url: string;
  contentType: string | null;
  authHeader: string | null;
  body: {
    resourceSpans: Array<{
      resource: { attributes: Array<{ key: string; value: { stringValue?: string } }> };
      scopeSpans: Array<{ spans: Array<Record<string, unknown>> }>;
    }>;
  };
}

function sampleSpan(): FinishedSpan {
  return {
    traceId: '123e4567-e89b-12d3-a456-426614174000',
    spanId: 'abcdef01-2345-6789-abcd-ef0123456789',
    parentSpanId: '11112222-3333-4444-5555-666677778888',
    name: 'GET /api/models',
    startTimeUnixNano: '1700000000000000000',
    endTimeUnixNano: '1700000000123000000',
    statusCode: 1,
    attributes: { 'http.method': 'GET', 'http.status_code': 200 },
  };
}

const FIXTURE = fileURLToPath(new URL('./otlp-collector.fixture.mjs', import.meta.url));

describe('OtlpTraceExporter — E2E against a real out-of-process collector', () => {
  let child: ChildProcessWithoutNullStreams;
  let rl: ReturnType<typeof createInterface>;
  let endpoint: string;
  const received: ReceivedRequest[] = [];

  before(async () => {
    child = spawn(process.execPath, [FIXTURE], { stdio: ['ignore', 'pipe', 'inherit'] });
    rl = createInterface({ input: child.stdout });
    let port: number | undefined;
    rl.on('line', (line) => {
      if (line.startsWith('PORT ')) port = Number(line.slice(5).trim());
      else if (line.startsWith('RECEIVED ')) received.push(JSON.parse(line.slice(9)));
    });
    // Wait for the collector to announce its ephemeral port.
    const deadline = Date.now() + 5000;
    while (port === undefined && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(port !== undefined, 'collector child did not report a port');
    endpoint = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    // Tear everything down explicitly so no libuv handle (child pipe / readline)
    // is mid-close when `--test-force-exit` retires the loop.
    rl.close();
    child.stdout.destroy();
    child.kill('SIGTERM');
    await once(child, 'exit').catch(() => undefined);
    await new Promise((r) => setTimeout(r, 25));
  });

  beforeEach(() => {
    clearEnv();
    received.length = 0;
  });
  afterEach(clearEnv);

  /** Poll until the child has reported `n` received exports (or time out). */
  async function waitForReceived(n: number, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (received.length < n && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(received.length, n, `expected ${n} export(s), got ${received.length}`);
  }

  it('really POSTs an OTLP/HTTP-JSON span to a live collector at /v1/traces', async () => {
    process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = endpoint;
    process.env['OTEL_SERVICE_NAME'] = 'e2e-gateway';

    const exporter = new OtlpTraceExporter();
    assert.equal(exporter.enabled, true);

    exporter.recordSpan(sampleSpan());
    await exporter.flush();
    await exporter.shutdown();

    await waitForReceived(1);
    const req = received[0]!;
    assert.equal(req.url, '/v1/traces', 'derived path must be /v1/traces');
    assert.equal(req.contentType, 'application/json');

    const resource = req.body.resourceSpans[0]!.resource;
    const svc = resource.attributes.find((a) => a.key === 'service.name');
    assert.equal(svc?.value.stringValue, 'e2e-gateway');

    const span = req.body.resourceSpans[0]!.scopeSpans[0]!.spans[0]! as {
      traceId: string;
      spanId: string;
      parentSpanId?: string;
      name: string;
      status: { code: number };
      attributes: Array<{ key: string; value: Record<string, unknown> }>;
    };
    assert.equal(span.name, 'GET /api/models');
    assert.equal(span.traceId.length, 32, 'traceId normalized to 32 hex chars');
    assert.equal(span.spanId.length, 16, 'spanId normalized to 16 hex chars');
    assert.match(span.traceId, /^[0-9a-f]+$/);
    assert.equal(span.parentSpanId?.length, 16);
    assert.equal(span.status.code, 1);
    const method = span.attributes.find((a) => a.key === 'http.method');
    assert.deepEqual(method?.value, { stringValue: 'GET' });
    const statusAttr = span.attributes.find((a) => a.key === 'http.status_code');
    assert.deepEqual(statusAttr?.value, { intValue: 200 });
  });

  it('forwards OTEL_EXPORTER_OTLP_HEADERS to the collector on a real POST', async () => {
    process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'] = `${endpoint}/v1/traces`;
    process.env['OTEL_EXPORTER_OTLP_HEADERS'] = 'Authorization=Bearer secret-token';

    const exporter = new OtlpTraceExporter();
    exporter.recordSpan(sampleSpan());
    await exporter.flush();
    await exporter.shutdown();

    await waitForReceived(1);
    assert.equal(received[0]!.authHeader, 'Bearer secret-token');
  });
});
