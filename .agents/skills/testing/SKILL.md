---
name: testing
description: How to write and run tests in this repo without booting the UI. Read before adding tests.
user-invocable: true
---

# Testing

Validate domain/util logic with tests before building the screen.

## Backend (`packages/api`)

- Native `node:test` + `node:assert/strict`. No jest/mocha/chai/sinon.
- Files: `src/**/*.test.ts`. Run: `npm run test --workspace=api`.
- Use `mock.method()` / `mock.timers()` for fakes and time control.

## Frontend (`packages/client`)

- Vitest. Specs live under `src/core/**/*.spec.ts` (that's the glob in
  `vitest.config.ts` — a spec elsewhere will NOT run).
- Run: `npm run test --workspace=client`.
- Prefer `vi.spyOn` over `vi.mock`.
- Test pure utilities directly (no `TestBed`) when they don't depend on DI —
  e.g. the smooth-stream util. Use fake timers / a stubbed
  `requestAnimationFrame` to assert the drain + flush behavior.

## Both

- `npm test` at the root runs both suites.
- When you touch domain/logic, leave a covering test.
