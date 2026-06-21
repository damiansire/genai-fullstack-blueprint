// Stability: 2 - Stable (global fetch — Node v22+)
// Stability: 2 - Stable (node:crypto)
import { randomBytes } from 'node:crypto';

/**
 * Real OTLP/HTTP trace exporter — native `fetch`, no OpenTelemetry SDK.
 *
 * "Built-in over dependencies": the span tree already has OTLP-genuine shape
 * (traceId / spanId / parentSpanId / depth), so instead of pulling in the heavy
 * `@opentelemetry/*` SDK we serialize spans into the OTLP/HTTP-JSON protobuf
 * mapping ourselves and POST them to a collector's `/v1/traces` endpoint.
 *
 * Opt-in & graceful degradation (the whole point):
 *   - Disabled unless `OTEL_EXPORTER_OTLP_ENDPOINT` (or `_TRACES_ENDPOINT`) is set.
 *     When disabled, `recordSpan` is a no-op — zero overhead, no background timers.
 *   - When enabled, spans are batched and flushed on an interval. Export failures
 *     (no collector, network down) are swallowed and never propagate into request
 *     handling — a missing collector must not break the gateway.
 *
 * Endpoint resolution (OTel env-var spec):
 *   OTEL_EXPORTER_OTLP_TRACES_ENDPOINT  (used verbatim if set)
 *   OTEL_EXPORTER_OTLP_ENDPOINT + '/v1/traces'
 *
 * OTLP/HTTP-JSON reference: opentelemetry.io/docs/specs/otlp/#otlphttp
 */

export interface FinishedSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  /** Epoch nanoseconds. */
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  /** OTLP status: 0=UNSET, 1=OK, 2=ERROR. */
  statusCode: 0 | 1 | 2;
  attributes: Record<string, string | number | boolean>;
}

/** The OTLP wire format wants 16-hex-char span ids and 32-hex-char trace ids. */
function toHex(input: string, bytes: number): string {
  // Our ids are UUIDs (with dashes). Strip non-hex and pad/truncate to width.
  const hex = input.replace(/[^0-9a-fA-F]/g, '');
  if (hex.length >= bytes * 2) return hex.slice(0, bytes * 2).toLowerCase();
  // Deterministic pad: repeat then trim. Falls back to random for empty input.
  const base = hex || randomBytes(bytes).toString('hex');
  return base.repeat(Math.ceil((bytes * 2) / base.length)).slice(0, bytes * 2).toLowerCase();
}

function attrValue(v: string | number | boolean) {
  if (typeof v === 'boolean') return { boolValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { intValue: v } : { doubleValue: v };
  return { stringValue: v };
}

function toOtlpSpan(s: FinishedSpan) {
  const span: Record<string, unknown> = {
    traceId: toHex(s.traceId, 16),
    spanId: toHex(s.spanId, 8),
    name: s.name,
    kind: 2, // SPAN_KIND_SERVER
    startTimeUnixNano: s.startTimeUnixNano,
    endTimeUnixNano: s.endTimeUnixNano,
    status: { code: s.statusCode },
    attributes: Object.entries(s.attributes).map(([key, value]) => ({
      key,
      value: attrValue(value),
    })),
  };
  if (s.parentSpanId) span['parentSpanId'] = toHex(s.parentSpanId, 8);
  return span;
}

export class OtlpTraceExporter {
  private readonly endpoint: string | undefined;
  private readonly serviceName: string;
  private readonly headers: Record<string, string>;
  private batch: FinishedSpan[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly maxBatch = 256;

  constructor() {
    const tracesEndpoint = process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'];
    const baseEndpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
    this.endpoint = tracesEndpoint
      ? tracesEndpoint
      : baseEndpoint
        ? `${baseEndpoint.replace(/\/$/, '')}/v1/traces`
        : undefined;
    this.serviceName = process.env['OTEL_SERVICE_NAME'] || 'ai-gateway';

    // Optional headers: OTEL_EXPORTER_OTLP_HEADERS="key1=val1,key2=val2"
    this.headers = { 'Content-Type': 'application/json' };
    const rawHeaders = process.env['OTEL_EXPORTER_OTLP_HEADERS'];
    if (rawHeaders) {
      for (const pair of rawHeaders.split(',')) {
        const idx = pair.indexOf('=');
        if (idx > 0) this.headers[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
      }
    }

    if (this.enabled) {
      // Flush periodically; .unref() so the exporter never keeps the process alive.
      this.timer = setInterval(() => void this.flush(), 5000);
      this.timer.unref();
    }
  }

  /** True only when a collector endpoint is configured (opt-in). */
  get enabled(): boolean {
    return this.endpoint !== undefined;
  }

  /** Record a finished span. No-op when the exporter is disabled. */
  recordSpan(span: FinishedSpan): void {
    if (!this.enabled) return;
    this.batch.push(span);
    if (this.batch.length >= this.maxBatch) void this.flush();
  }

  /**
   * Flush the current batch to the collector. Failures are swallowed so a missing
   * or flaky collector never affects request handling (graceful degradation).
   */
  async flush(): Promise<void> {
    if (!this.enabled || this.batch.length === 0) return;
    const spans = this.batch;
    this.batch = [];

    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: 'service.name', value: { stringValue: this.serviceName } }],
          },
          scopeSpans: [
            {
              scope: { name: 'ai-gateway-native-otlp', version: '1.0.0' },
              spans: spans.map(toOtlpSpan),
            },
          ],
        },
      ],
    };

    try {
      await fetch(this.endpoint!, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(payload),
        // Don't let a slow collector hold a request's resolution.
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Intentionally swallowed: telemetry export must never break the app.
      // Dropped spans are acceptable; we do not retry to avoid unbounded buildup.
    }
  }

  /** Flush remaining spans on shutdown. */
  async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }
}

export const otlpTraceExporter = new OtlpTraceExporter();
