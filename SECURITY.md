# Security review

This is a real security review of the AI Gateway (`packages/api`), not a marketing
page. It checks the four concrete controls this project committed to, states which
ones were already covered by existing code versus added by this review, and is
explicit about what still is not covered. Threat-model boundaries and the load
test are in [`docs/load-test.md`](./docs/load-test.md); this document is the
narrower, security-specific companion.

Reporting a vulnerability: open a private GitHub security advisory on this repo
(`Security` tab -> `Report a vulnerability`). Do not open a public issue for an
unpatched vulnerability.

## 1. No credential logging

**Status: covered, verified.**

- API keys are never logged by value. `apiKeyAuth.ts:57` logs `validation.keyId`,
  which is the **name of the environment variable** (`API_KEY_1`, `API_KEY_2`, ...),
  not the key value itself (`apiKeyAuth.ts:106-130` parses `API_KEY_*` into
  `{ id: envKey, key, permissions }`; only `id` is ever passed to the logger).
- Provider credentials (`GEMINI_API_KEY`, `OPENAI_API_KEY`) are read from
  `process.env` at call time and only ever placed inside the outbound request URL
  / `Authorization` header sent to the provider (`plugins/gemini-image-gen/index.ts`,
  `plugins/openai-chat/index.ts`) - never passed to `logger.*`.
- Verified with a repo-wide check: no `logger.*` call anywhere in `packages/api/src`
  references `apiKey`/`API_KEY` as a value (only as the env-var name string above).
- API key comparison uses `timingSafeEqual` (`apiKeyAuth.ts:88`), not `===`, so a
  malformed/wrong key does not leak timing information about how many characters
  matched.

## 2. Own rate limiting (no third-party dependency)

**Status: covered, verified, load-tested.**

Per `AGENTS.md` ("Built-in over dependencies"): no `express-rate-limit`. Two
independent, native `Map`-backed limiters, both fail-closed:

- **Request-count limiter**: `api/middleware/rateLimiter.ts`, wired at
  `server.ts:185-189` (100 req/min per API key). Verified under real concurrent
  load in `docs/load-test.md` ("Resultado 2"): exactly 100x200 / 50x429 out of
  150 concurrent requests - the limit is not aspirational.
- **Token-budget limiter**: `api/middleware/tokenRateLimiter.ts`, wired at
  `server.ts:191-195` (50,000 tokens/min per API key). Checked before the model
  call and consumed after, in `modelController.ts:104-121`.
- Both implement the `RateLimitStore` interface with an in-memory and a SQLite
  backend (`InMemoryRateLimitStore` / `SqliteRateLimitStore`), and both **fail
  closed** on a store error (a broken store denies traffic instead of silently
  admitting everything).
- Known, documented limit (not a gap this review silently ignores): the store is
  per-process. Multi-instance/distributed rate limiting behind a load balancer is
  **not** verified - listed as a non-goal in `docs/load-test.md`.

## 3. Multimodal input validation

**Status: gap found and fixed by this review.**

Before this change, `gemini-image-gen`'s AJV `configSchema`
(`plugins/gemini-image-gen/index.ts`) only required `inputImages[].data` /
`mimeType` to be present **strings** - no size bound, no MIME allowlist, no cap
on how many images could be sent per request. The only zod schema in that file
(`geminiResponseSchema`) validated what Gemini sent **back**, not what the user
sent in.

Fixed: `plugins/gemini-image-gen/index.ts` now runs a zod schema
(`inputImagesRequestSchema`) on `params.inputImages` before building the Gemini
request:

- **Size**: each `data` field is capped at the base64-length equivalent of 10MB
  decoded (`MAX_BASE64_IMAGE_LENGTH`) - the same 10MB ceiling the multipart
  upload path already enforces in `modelRoutes.ts` (multer `fileSize` limit), so
  the base64-in-JSON path can no longer bypass a limit the binary-upload path
  already has.
- **MIME type**: whitelisted to `image/jpeg`, `image/png`, `image/gif`,
  `image/webp` (`ALLOWED_IMAGE_MIME_TYPES`) - matches multer's `fileFilter`
  allowlist for images.
- **Count**: capped at 5 images per request (`MAX_INPUT_IMAGES`), matching
  multer's `files: 5` limit.
- **Format**: `data` is checked against the base64 alphabet
  (`BASE64_PATTERN`) so a `data:` URI prefix, raw text, or other garbage
  disguised as base64 is rejected before it reaches Gemini, not after a wasted
  API call.

A validation failure throws `ApiError.badRequest` (HTTP 400) with the specific
field(s) that failed, instead of a generic 500 - see
`plugins/gemini-image-gen/index.test.ts` for the covering tests (oversized
payload, disallowed MIME, invalid base64, too many images, and the
happy/no-input-images paths).

Other boundary input in this gateway (`invoke-model.usecase.ts`'s
`invokeBodySchema`, the AJV `configSchema` per plugin) was already zod/AJV
validated; this review's scope was specifically the multimodal input gap.

## 4. Prompt-injection detection

**Status: covered, verified.**

`infrastructure/workers/safetyWorker.ts` runs a weighted heuristic classifier
(`classify()`) off the main thread (Worker Thread pool), covering:

- Prompt injection (`ignore previous instructions`, `disregard the system
  prompt`, `reveal your system prompt`, jailbreak/DAN framing, "bypass ...
  filter/safety/guard") - `INJECTION_PATTERNS`, `safetyWorker.ts:41-54`.
- Toxicity (`TOXICITY_PATTERNS`, `safetyWorker.ts:56-58`).
- DLP: API-key-shaped and PEM-private-key-shaped strings leaving the perimeter
  inside a prompt (`DLP_PATTERNS`, `safetyWorker.ts:61-64`).
- Trivial obfuscation resistance: zero-width character stripping and whitespace
  collapsing before matching (`normalize()`, `safetyWorker.ts:72-78`).

Wired into every request via `ai-safety.middleware.ts`, which runs PII masking
synchronously (always) and the classifier asynchronously in the worker pool.
**Documented, deliberate posture**: the classifier is fail-OPEN
(`FAIL_CLOSED = false`, `ai-safety.middleware.ts:22`) - if the worker errors,
PII is already masked and the request is allowed through rather than taking the
whole gateway down on a classifier hiccup. This is an explicit availability
trade-off written in the code (not a silent gap), with the flag to flip it to
fail-closed for a stricter deployment. This posture, and why it differs from
auth/rate-limit (which fail closed), is also documented in
`docs/load-test.md`'s threat-model table.

**Honestly not covered** (this is a heuristic classifier, not a model): novel
phrasings outside the pattern list, multi-turn/slow-drip injection spread across
several messages, and non-English injection phrasings are not detected. The
worker's own top-of-file comment documents this is the seam where a real SLM
(Phi-3.5, Llama-Guard) would replace the heuristic body with no caller changes -
that upgrade is future work, not shipped today.

## What this review did NOT do

- No formal penetration test or adversarial fuzzing of the safety classifier
  (also listed as a non-goal in `docs/load-test.md`).
- No dependency/SCA (software composition analysis) audit of third-party
  packages in this pass.
- No review of the Angular client's XSS/CSP posture - this document is scoped to
  the API gateway.
