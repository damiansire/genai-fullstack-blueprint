// Stability: 2 - Stable (node:async_hooks - AsyncLocalStorage)
// Stability: 2 - Stable (node:crypto - randomUUID)
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { otlpTraceExporter, type FinishedSpan } from './otlp-exporter.js';

/**
 * Full agentic tree context.
 * Patrón 5: AsyncLocalStorage Extendido para Árboles Agenticos.
 *
 * Every HTTP request starts a root span (depth=0).
 * Each tool call executed in a Worker Thread branches from its parent
 * via createChildContext(), producing a traceable span tree without
 * polluting any function signatures (zero prop-drilling).
 *
 * Compatible with any OTLP collector (Jaeger, Grafana Tempo):
 *   traceId      → groups the entire user request
 *   spanId       → identifies the current execution unit
 *   parentSpanId → links to the caller (reconstructs the tree)
 *   depth        → guards against infinite agentic recursion
 *   toolCallStack → ordered list of tool names active in the current branch
 */
export interface RequestContext {
  /** Unique ID for the entire request/conversation. Stays constant across all spans. */
  traceId: string;
  /** Unique ID for this specific execution unit (HTTP handler or tool call). */
  spanId: string;
  /** spanId of the caller. undefined only for the root HTTP span. */
  parentSpanId?: string;
  /** Recursion depth in the agentic loop (0 = root HTTP handler). */
  depth: number;
  /** Ordered stack of tool names active in the current branch. Useful for cycle detection. */
  toolCallStack: string[];
  /** Wall-clock start (epoch ns) of this span, used to compute OTLP duration. */
  startTimeUnixNano?: string;
}

/** Current epoch time in nanoseconds, as the string OTLP expects. */
function nowUnixNano(): string {
  // Date.now() gives ms; multiply to ns. Sub-ms precision isn't needed for span boundaries.
  return (BigInt(Date.now()) * 1_000_000n).toString();
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/** Read the entire context for the current async execution. */
export function getContext(): RequestContext | undefined {
  return requestContext.getStore();
}

/** Read only the traceId — backwards-compatible with all existing callers. */
export function getTraceId(): string | undefined {
  return requestContext.getStore()?.traceId;
}

/**
 * Creates a child context derived from the current store.
 * Call this inside a Worker Thread's workerData handler to inherit
 * the parent trace without a new HTTP boundary.
 *
 * @param toolName  The tool being invoked in the child span.
 * @param parentCtx The context serialized from the parent thread (workerData).
 */
export function createChildContext(
  toolName: string,
  parentCtx: RequestContext
): RequestContext {
  return {
    traceId: parentCtx.traceId,
    spanId: randomUUID(),
    parentSpanId: parentCtx.spanId,
    depth: parentCtx.depth + 1,
    toolCallStack: [...parentCtx.toolCallStack, toolName],
    startTimeUnixNano: nowUnixNano(),
  };
}

/**
 * Creates the root context for an incoming HTTP request.
 * Called once per request in the Express middleware.
 */
export function createRootContext(traceId: string): RequestContext {
  return {
    traceId,
    spanId: randomUUID(),
    // parentSpanId intentionally omitted (root span has no parent)
    depth: 0,
    toolCallStack: [],
    startTimeUnixNano: nowUnixNano(),
  };
}

/**
 * Finish the span carried by the given context and hand it to the OTLP exporter.
 * No-op work when the exporter is disabled (it ignores the span), so callers can
 * call this unconditionally on request finish.
 *
 * @param ctx          The span context to close (typically the root request span).
 * @param name         Span name, e.g. "POST /api/models/:id/invoke".
 * @param statusCode   OTLP status: 0=UNSET, 1=OK, 2=ERROR.
 * @param attributes   Extra span attributes (http.method, http.status_code, …).
 */
export function finishSpan(
  ctx: RequestContext,
  name: string,
  statusCode: 0 | 1 | 2 = 1,
  attributes: Record<string, string | number | boolean> = {},
): void {
  const span: FinishedSpan = {
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    name,
    startTimeUnixNano: ctx.startTimeUnixNano ?? nowUnixNano(),
    endTimeUnixNano: nowUnixNano(),
    statusCode,
    attributes: { 'span.depth': ctx.depth, ...attributes },
  };
  if (ctx.parentSpanId) span.parentSpanId = ctx.parentSpanId;
  otlpTraceExporter.recordSpan(span);
}
