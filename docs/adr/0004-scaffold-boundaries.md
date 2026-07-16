# ADR 0004: Declared boundaries of the scaffold

- Status: accepted
- Date: 2026-07-16

## Context

This repository is copied as a starting point (a blueprint), which makes silent
gaps dangerous: whatever the README implies is production-ready will be treated
as production-ready. The honest move is to write down where the reference
implementation ends, in one place, and keep the list current.

## Decision

The following are explicitly out of scope or partial, and the README must say
so as long as they remain true:

1. **Multi-tenancy is a design, not an implementation.** Authentication is by
   static API key (`apiKeyAuth.ts`); there is no JWT verification, no
   per-tenant data segregation, and the `rbac` middleware resolves every
   request to the most restrictive tier because no identity source populates
   it. No GDPR/HIPAA claim can be made on top of this as-is.

2. **Semantic caching is optional and off by default.** The exact-match
   (SHA-256) cache always works; the paraphrase-tolerant path requires the
   `sqlite-vec` SQLite extension provided at runtime. Without it the database
   logs `Semantic vector search disabled` and paraphrased queries miss.

3. **The browser must not hold a privileged key.** `API_CONFIG.apiKey` exists
   so local development can authenticate against the fail-closed gateway. A
   production deployment injects the key via a same-origin proxy; shipping it
   in the bundle re-creates the exact problem ADR 0001 exists to solve.

4. **Test coverage is asymmetric by layer, on purpose.** The backend suite
   covers the domain end to end, including HTTP integration tests that boot
   the real gateway. The frontend suite covers the domain layer (SSE parsing,
   streaming render pacing, dynamic form generation, interceptor scoping,
   route table) under Vitest/JSDOM. Component-template rendering and full
   browser E2E are not part of CI; the Docker smoke test only proves the built
   client serves.

5. **No hosted deployment, SLA, or formal penetration test.** What exists is a
   measured load burst and soak test (`docs/load-test.md`) and a scoped
   security review (`SECURITY.md`). Single-process in-memory state (rate
   limits, circuit breakers) is correct for one node and wrong for a fleet.

## Consequences

- Anyone extending the scaffold knows which walls are load-bearing and which
  are painted on. Items graduate off this list only when the implementation
  and its tests land (rule: no claim without a gate that enforces it; the
  README test counts are generated and CI-checked by
  `scripts/update-metrics.mjs --check`).
- The README's capability sections link maturity honestly (e.g. the
  multi-tenant section is marked "design, not yet implemented"); keeping that
  framing accurate is part of the definition of done for any related change.
