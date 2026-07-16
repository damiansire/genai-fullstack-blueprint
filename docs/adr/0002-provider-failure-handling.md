# ADR 0002: What happens when Gemini fails or rate-limits

- Status: accepted
- Date: 2026-07-16

## Context

External LLM APIs fail routinely: 429s with `Retry-After`, 5xx bursts, timeouts,
region incidents. A gateway that just forwards those failures teaches every
caller to retry, which amplifies the outage. The blueprint needs one written
policy for degraded providers, not per-plugin improvisation.

## Decision

Three layers, each with a single implementation:

1. **Retry with header-aware backoff** for one request
   (`src/infrastructure/http/resilient-transport.ts`). It is the only
   retry/backoff implementation in the codebase; plugins must not hand-roll
   `fetch` loops. 4xx is not retried (except 408/429) because retrying a bad
   request only burns quota. `Retry-After` / `retry-after-ms` headers are
   honored but clamped by `maxDelayMs`, so a hostile or absurd header cannot
   park a request for minutes (covered in `resilient-transport.test.ts`).

2. **Circuit breaker per provider** for repeated failures
   (`src/core/circuit-breaker.ts`). After `failureThreshold` consecutive
   failures the circuit opens and calls fast-fail without touching the
   provider. After `resetTimeoutMs` a single HALF_OPEN probe tests recovery;
   concurrent callers keep fast-failing so no thundering herd hits a
   recovering backend.

3. **Fallback chain across providers** when a circuit is open
   (`src/application/useCases/invoke-model.usecase.ts`). The chain is
   configuration, not code: `FALLBACK_MODEL_CHAIN` (comma-separated modelIds,
   default `openai-gpt-4o-mini,llama-3.1-8b`). An unconfigured or unregistered
   fallback is skipped rather than fatal, so the same code runs with zero, one
   or many alternate providers. The degraded response is marked with a
   `[SYSTEM_FALLBACK]` system message so downstream consumers can tell a
   fallback answer from a primary one.

On the streaming path, failures surface to the client as SSE `event: error`
frames (see ADR 0003) instead of a silently truncated stream.

Boundary defaults are documented in the code itself: authentication is
fail-closed (`apiKeyAuth.ts`), while the AI safety classifier is deliberately
fail-open (`ai-safety.middleware.ts`) with the tradeoff written next to the
code.

## Consequences

- A Gemini outage degrades to OpenAI (and then to a local SLM slot) without
  client changes; with no fallbacks configured the caller gets a fast, honest
  error instead of a hanging request.
- Every layer is unit-tested (`circuit-breaker.test.ts`,
  `resilient-transport.test.ts`, `invoke-model.usecase.test.ts`); the README's
  test counts include these.
- Limits: breaker state and rate-limit buckets are in-memory and per-process,
  which is the correct scope for a single-node blueprint but must move to
  shared storage (e.g. Redis) in a multi-instance deployment.
