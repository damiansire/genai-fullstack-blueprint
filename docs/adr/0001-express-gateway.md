# ADR 0001: An Express gateway between the browser and the LLM providers

- Status: accepted
- Date: 2026-07-16

## Context

The client needs multimodal AI (text, OCR, image generation) from Google Gemini and,
since the fallback chain landed, OpenAI. Calling provider APIs straight from the
browser is the shortest path and it is exactly what this blueprint refuses to do:

1. A provider API key embedded in a browser bundle is public. There is no way to
   scope or revoke it per user, and quota abuse lands on the bill.
2. Per-user rate limits, token budgets, PII masking and prompt-injection checks
   have to run somewhere the user cannot bypass with devtools.
3. Provider churn (new models, new vendors) should not force client releases.

## Decision

All model traffic goes through a Node.js/Express gateway (`packages/api`). The
browser talks only to `/api/*`; the gateway owns provider credentials and applies
the policy chain `auth -> rate-limit -> token-limit -> safety -> handler` (wired in
`src/api/routes/modelRoutes.ts`, integration-tested end to end in
`src/server.integration.test.ts`).

Express specifically, rather than Nest/Fastify or a hosted proxy, because of the
repo's "built-in over dependencies" philosophy (see `AGENTS.md`): the gateway adds
its own layering (routes -> controllers -> use cases -> plugins), so a minimal,
ubiquitous HTTP framework is enough. Everything the framework does not provide is
implemented on Node primitives on purpose: native `node:test`, an in-memory rate
limiter over `Map`, `AsyncLocalStorage` tracing, native `fetch`.

Providers plug in behind one port: every model implements `IModelStrategy`
(`src/domain/ai/strategy.interface.ts`) and is registered in a factory, so the
client never learns which vendor served a request.

## Consequences

- The gateway is a single choke point: auth is fail-closed (`apiKeyAuth.ts`
  rejects when no keys are configured), and every request carries a `traceId`.
- Adding a provider is a new plugin plus registry entry; no client change.
- The cost is operating a server (Docker Compose ships it) and the browser key
  situation moves rather than disappears: the client authenticates to the gateway
  with `X-API-Key`, so production deployments must inject that key via a
  same-origin proxy instead of baking a privileged key into the bundle (see the
  note on `API_CONFIG` in `packages/client/src/app/core/tokens/api-config.ts`).
