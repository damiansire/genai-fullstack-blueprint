# ADR 0003: Token streaming via SSE, native fetch and frame-paced rendering

- Status: accepted
- Date: 2026-07-16

## Context

LLM responses take seconds; users need first tokens immediately. The transport
and the rendering strategy are separate decisions and both have common failure
modes: WebSocket infrastructure for a one-way flow, buffered HTTP clients that
defeat streaming, and UIs that re-render once per token and jank.

## Decision

**Transport: Server-Sent Events over plain HTTP.** Token streaming is
unidirectional, so SSE (`POST /api/models/:id/stream`,
`src/api/controllers/modelController.ts`) wins over WebSockets: it needs no
upgrade handling, passes proxies as normal HTTP, and inherits the gateway's
middleware chain (auth, rate limit) unchanged. The wire contract is explicit:

- `data: {"text": "..."}` frames carry token deltas.
- `event: error` frames carry structured failures (rate limit, provider down),
  so the client can show a real message instead of a truncated answer.
- `data: [DONE]` is the termination sentinel, always sent, so clients never
  hang on an idle socket.

**Client transport: native `fetch` + `ReadableStream`, not `HttpClient`.**
Angular's `HttpClient` materializes the response before emitting, which
serializes the whole point of streaming. `AiStreamService`
(`packages/client/src/app/core/services/ai-stream.service.ts`) reads the body
incrementally, and because it bypasses `HttpClient` it attaches `X-API-Key`
manually (the interceptor only covers `HttpClient` traffic). SSE records can
split across TCP packets, so the parser keeps a leftover buffer and only
processes records terminated by a blank line; the reassembly cases are pinned
in `ai-stream.service.spec.ts`.

**Rendering: at most one signal write per animation frame.** Raw chunks are
enqueued character by character and drained on `requestAnimationFrame` at an
adaptive speed (`packages/client/src/core/streaming/smooth-stream.ts`). The
invariant, documented in `AGENTS.md`, is that no code calls `signal.set` once
per raw SSE chunk: chunk bursts would cause jank and O(n^2) re-concatenation.
On finish or abort the queue is flushed so no characters are stranded.

## Consequences

- The full path is testable without a browser or a real provider: the server
  side boots in integration tests, and the client parser and pacing utility
  run under Vitest with a mocked `fetch`.
- SSE is one-way; if a future feature needs client-to-server push during
  generation (e.g. tool-result round trips), that will be a new decision, not
  a WebSocket bolted onto this one.
- Reconnection is not automatic: a dropped stream ends with `streamError` set
  and the user retries. Acceptable for chat-style UX; a background consumer
  would need `Last-Event-ID` style resumption.
