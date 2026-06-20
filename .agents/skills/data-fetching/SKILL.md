---
name: data-fetching
description: Where data fetching belongs in the client and what must never call the network directly. Read before adding a fetch/HttpClient call.
user-invocable: true
---

# Data fetching

Keep a single, predictable pipeline: **Component → Service → API**.

## DO

- Put all network access behind a service in `src/app/core/services/`
  (or `src/core/`). Components read Signals exposed by the service.
- Validate responses at the boundary with `zod` schemas (see
  `src/core/ai/schemas/`).
- For SSE/streaming use the native `fetch` + Web Streams reader pattern already
  in `ai-stream.service.ts` (no `@microsoft/fetch-event-source`, no
  `ngx-sse-client`). Render via the **streaming-render** skill.
- Use `AbortController` for cancellation and re-entrancy.

## DON'T

- Never call `fetch` / `HttpClient` directly from a component or template.
- Never use `useEffect`-style ad-hoc fetching tied to render — model loading as
  Signal state on the service.
- Never parse provider JSON without a schema guard.
