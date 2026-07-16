# Architecture Decision Records

Decisions that shape this blueprint, with their context and consequences.
Format: lightweight ADR (status, context, decision, consequences). New
decisions get the next number; superseded ones are marked, never deleted.

| ADR | Decision |
| --- | --- |
| [0001](./0001-express-gateway.md) | An Express gateway between the browser and the LLM providers |
| [0002](./0002-provider-failure-handling.md) | What happens when Gemini fails or rate-limits (retry, circuit breaker, fallback chain) |
| [0003](./0003-streaming-strategy.md) | Token streaming via SSE, native fetch and frame-paced rendering |
| [0004](./0004-scaffold-boundaries.md) | Declared boundaries of the scaffold (what this repo does not claim) |

Related, decision-adjacent docs: [`REGISTRY.md`](../../REGISTRY.md) (patterns and
API reference), [`SECURITY.md`](../../SECURITY.md) (scoped security review),
[`docs/load-test.md`](../load-test.md) (measured load numbers).
