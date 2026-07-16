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
- Frontend: Vitest (`npm run test --workspace=client`). Specs are colocated
  with their source under `src/**/*.spec.ts` (see `vitest.config.ts`).
  TestBed works for service/DI specs and inline-template components;
  external `templateUrl` components cannot be compiled under this JIT setup,
  and signal inputs (`input()`) are not written by JIT-compiled templates,
  so keep component specs template-free or inline-template with plain APIs
  (see `src/test-setup.ts`).
- When you touch domain/logic, leave a test that covers it. Prefer testing
  domain/util logic without the UI before wiring screens.
- `npm test` at the root runs both suites.
- The README test counts regenerate with `node scripts/update-metrics.mjs`;
  CI runs `--check` and fails on drift, so update the README via the script,
  never by hand.

## Skills

Reusable, executable conventions live in `.agents/skills/<name>/SKILL.md`.
Read the relevant skill before working in that area instead of re-deriving it:

- **streaming-render** — how to smoothly render LLM token streams (rAF + char
  queue + adaptive speed). Read before touching `ai-stream.service.ts` / SSE.
- **data-fetching** — where data fetching belongs and what must never call the
  network directly.
- **testing** — how to write and run tests in this repo without booting the UI.

## World-class standard

Piso transversal de `/fragua` (`fellow-standard.md`) + reglas de los stacks
`genai`/`node-apis` del corpus (`~/.claude/tools/_audit-tools/refs/`). El
"Core philosophy" de arriba ya cubre buena parte por construcción; lo explícito:

- **Fail-closed vs fail-open, siempre documentado en el propio código, no en
  un doc aparte** (ítem i/j): ya es el patrón acá — ver
  `apiKeyAuth.ts:132` (fail-closed sin keys) y `ai-safety.middleware.ts:15-22`
  (fail-open deliberado del classifier, con el comentario explicando el
  tradeoff). Nueva regla que se agrega escrita así, no como excepción tácita.
- **Boundaries con traza estructurada** (ítem h): `AsyncLocalStorage`
  (`traceId`) ya cubre esto — todo nuevo boundary (ruta, worker, cola) debe
  loguear con ese `traceId`, no un `console.log` suelto.
- **Claim de perf/robustez con prueba reproducible** (ítem l): el conteo de
  tests del README se genera solo (`scripts/update-metrics.mjs`, gateado en CI)
  y `docs/load-test.md` mide una carga real, no una cifra tipeada. Cualquier
  claim nuevo de número (throughput, latencia, tokens/seg) sigue ese patrón:
  medido con un script reproducible, no escrito a mano.
- **Framing honesto de límites** (ítem m): el README declara explícito qué NO
  cubre (soak test, security audit formal, load contra Gemini real). Al sumar
  una capa nueva, actualizar esa lista en vez de dejarla stale.
