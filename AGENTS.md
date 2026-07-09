# AGENTS.md

Canonical instructions for AI coding agents working on **genai-fullstack-blueprint**.
This file is the single source of truth: `CLAUDE.md` and `GEMINI.md` are thin
pointers to this document — keep guidance here, not duplicated elsewhere.

## Core philosophy: "Built-in over dependencies"

Prefer the platform's native capabilities over third-party packages. Concretely:

- **No `dotenv`** — use `process.loadEnvFile()` / `node --env-file`.
- **No `jest` / `mocha` / `chai` / `sinon`** — use native `node:test` and
  `node:assert/strict` with `mock.method()` and `mock.timers()`.
- **No `ws` / `socket.io`** — handle the HTTP upgrade event manually if needed.
- **No `express-rate-limit`** — the project ships a native in-memory limiter (`Map`).
- **No UUID libraries** — use `node:crypto` `randomUUID()`.

## Repository layout

Monorepo with npm workspaces:

- `packages/api` — Node.js (v22+) / Express backend. Runs TypeScript natively
  via `node --experimental-strip-types` (no build step). Clean Architecture.
- `packages/client` — Angular 21 frontend. Standalone components, Signals,
  zoneless, `@defer`, `inject()`.

## Backend conventions (`packages/api`)

- Clean Architecture: business logic lives in **Use Cases**; controllers are thin
  (map HTTP ⇄ DTO, call a use case).
- Validate **all** boundary input with `zod`.
- Use `AsyncLocalStorage` (`node:async_hooks`) for `traceId` / observability —
  never thread `traceId` through call signatures manually.
- Prefer `performance.now()` over `Date.now()` for metrics.
- Never leak `syscall` / `path` from native system errors into HTTP responses.
- Assume external LLM APIs fail: implement graceful degradation and circuit-breaker
  behavior.

## Frontend conventions (`packages/client`)

- Modern Angular only: standalone components, Signals (`signal`, `computed`,
  `effect`, `linkedSignal`), `@defer` for lazy loading, `inject()` over
  constructor injection, `ChangeDetectionStrategy.OnPush`.
- Optimize for INP: yield heavy DOM work (`scheduler.yield()`).
- For Generative UI, use dynamic component loading.
- **Streaming render:** never call `signal.set/update` once per raw SSE chunk.
  Chunks arrive in irregular bursts and cause jank. Enqueue characters and drain
  them on `requestAnimationFrame` at an adaptive speed, flushing the queue on
  abort/finish. See the **streaming-render** skill.

## Testing

- Backend: native `node:test` (`npm run test --workspace=api`).
- Frontend: Vitest (`npm run test --workspace=client`). Specs live under
  `src/core/**/*.spec.ts` (see `vitest.config.ts`).
- When you touch domain/logic, leave a test that covers it. Prefer testing
  domain/util logic without the UI before wiring screens.
- `npm test` at the root runs both suites.

## Skills

Reusable, executable conventions live in `.agents/skills/<name>/SKILL.md`.
Read the relevant skill before working in that area instead of re-deriving it:

- **streaming-render** — how to smoothly render LLM token streams (rAF + char
  queue + adaptive speed). Read before touching `ai-stream.service.ts` / SSE.
- **data-fetching** — where data fetching belongs and what must never call the
  network directly.
- **testing** — how to write and run tests in this repo without booting the UI.
