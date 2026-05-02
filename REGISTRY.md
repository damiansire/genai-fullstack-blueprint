# Architectural and Technical References

- **Thursday, April 30**: Applied [https://angular.dev/ai](https://angular.dev/ai)
  - **Implemented Practices:** 
    - **API Key Security:** Absolute prohibition of exposing credentials in `environments.ts`; all traffic must pass through a Proxy or Firebase AI Logic layer.
    - **Tool Calling:** Pattern to expand integrations beyond simple Chatbots (Q&A).
    - **Non-Determinism Handling:** 
      - Structural restrictions using Schemas (Zod).
      - *Human in the Loop* pattern (Human approval before executing critical flows on the client).
      - *Graceful degradation* upon API failures or corrupted payloads.

- **Friday, May 1**: Applied modern Node.js APIs ([https://nodejs.org/docs/latest/api/](https://nodejs.org/docs/latest/api/))
  - **Implemented Practices in the AI Gateway (`packages/api`):**
    - General refactoring to use native modules and reduce third-party package dependencies.
    - **`process.loadEnvFile()`**: Complete removal of the `dotenv` package. Implemented in `server.ts` for native `.env` loading. 
      - *Source*: [Node.js process API](https://nodejs.org/docs/latest/api/process.html#processloadenvfilepath)
    - **`node:util` (`parseArgs`)**: Implemented in `server.ts` for typed, native CLI argument parsing for the server (e.g., dynamic port configuration via `-p`). 
      - *Source*: [Node.js util API](https://nodejs.org/docs/latest/api/util.html#utilparseargsconfig)
    - **`node:test` and `node:assert/strict`**: Implementation of the `models/registry.test.ts` test suite using the built-in Node.js test runner with `tsx` (modified test script in `package.json`), avoiding heavy dependencies like Jest. Refactored the test suite to use `node:assert/strict` ensuring that all equality checks (`equal`, `deepEqual`) use strict equality (`===`), which prevents unexpected type coercion issues present in the legacy `node:assert` mode.
      - *Source*: [Node.js test runner API](https://nodejs.org/docs/latest/api/test.html) and [Node.js assert API](https://nodejs.org/docs/latest/api/assert.html)
    - **`node:sqlite` (`DatabaseSync`)**: Creation of a native database service in `src/services/db.ts` to register and persist HTTP request logs and their durations directly in SQLite synchronously, integrated into the `server.ts` middleware.
      - *Source*: [Node.js sqlite API](https://nodejs.org/docs/latest/api/sqlite.html)
    - **`node:perf_hooks` (`performance.now()`)**: Replacement of `Date.now()` throughout the gateway (`server.ts`, `modelController.ts` and plugins) with `performance.now()`. This provides high-resolution execution time metrics immune to system clock jumps.
      - *Source*: [Node.js perf_hooks API](https://nodejs.org/docs/latest/api/perf_hooks.html)
    - **`node:timers/promises` (`setTimeout`)**: Substitution of the manual pattern based on `new Promise(resolve => setTimeout(resolve, delay))` with the native promise-based `setTimeout` function, substantially cleaning and simplifying latency simulations in the plugins.
      - *Source*: [Node.js timers/promises API](https://nodejs.org/docs/latest/api/timers.html#timers-promises-api)
    - **`node:crypto` (`randomUUID()` and `randomInt()`)**: 
      - *Traceability*: Implemented `randomUUID()` in `server.ts` to generate a unique tracking ID (`trace_id`) for every incoming HTTP request, appending it to the SQLite logger and returning it in the `X-Trace-Id` headers.
      - *Secure RNG*: Replaced `Math.random()` instances across all *plugins* with cryptographically secure generators like `randomInt()` for mock scenario selection and simulated random failures.
      - *Source*: [Node.js crypto API](https://nodejs.org/docs/latest/api/crypto.html)

- **Friday, May 1 (Continued)**: Applied performance best practices based on [https://angular.dev/](https://angular.dev/)
  - **Implemented Practices in the Angular Client (`packages/client`):**
    - **Deferrable Views (`@defer`)**: Implemented in the `text-model`, `image-model`, and `image-generation` views to delay loading the heavy `<app-model-response>` component until necessary, improving First Contentful Paint (FCP).
    - **Asynchrony with Signals and Zod**: Refactored `AiOrchestratorService` by replacing synchronous parsing with `await aiResponseSchema.parseAsync()`. This forces microtask creation, preventing Angular from grouping synchronous Signal changes and allowing the loading visual transition (`isLoading: true`) to effectively impact the UI.
    - **Injection Modernization**: Cleaned up empty constructors, consolidating the standard based on `inject()`.
    - **AppConfig Optimization (`app.config.ts`) (per `angular.dev/overview`)**:
      - Implemented `provideHttpClient(withFetch())` to force the use of the native Fetch API instead of XHR, improving interoperability with Workers and SSR, besides being the new recommended standard in Angular v18+.
      - Configured the modern Router using `withComponentInputBinding()` and `withViewTransitions()` in `provideRouter`, aligning the project with the latest View Transitions API capabilities native to browsers and simplifying URL parameter access directly via `input()` in Standalone components.

- **Friday, May 1 (Later)**: Applied learnings from [Introduction to Node.js](https://nodejs.org/learn/getting-started/introduction-to-nodejs)
  - **Implemented Practices in the AI Gateway (`packages/api`):**
    - **Native `node:http` Server**: Explicitly integrated the `createServer` method from the native `node:http` module in `server.ts` to manage the HTTP server instance. This replaces relying solely on Express's abstraction (`app.listen()`), giving us a more foundational architectural control over the single-process, non-blocking I/O event loop runtime that defines Node.js.

- **Friday, May 1 (Latest)**: Applied Node.js Async Hooks ([https://nodejs.org/docs/latest/api/async_hooks.html](https://nodejs.org/docs/latest/api/async_hooks.html))
  - **Implemented Practices in the AI Gateway (`packages/api`):**
    - **`AsyncLocalStorage` from `node:async_hooks`**: Introduced native asynchronous context tracking in the Express middleware (`src/core/async-context.ts` and `src/server.ts`). This allows passing request-scoped metadata (such as the `trace_id` generated by `node:crypto`) implicitly down the call chain.
    - **Context-Aware Logging**: Refactored the `logRequest` function in `src/services/db.ts` to consume the `traceId` directly from the `AsyncLocalStorage` execution context. This eliminated the need to explicitly pass the trace parameter through intermediate functions, cleaning the API surfaces while keeping robust request tracing across the async event loop.
- **Friday, May 1 (Node.js Error Handling)**: Applied knowledge from [Node.js Errors API](https://nodejs.org/docs/latest/api/errors.html)
  - **Implemented Practices in the AI Gateway (`packages/api`):**
    - **System Errors Identification**: Modified global error handlers (`server.ts` and `errorHandler.ts`) to intercept and safely process Node.js native System Errors (e.g., `ENOENT`, `ECONNREFUSED`).
    - **Safe Information Disclosure**: Avoided exposing internal properties like `syscall`, `path`, `address`, or `port` in production responses to prevent path traversal leaks or internal network topology disclosure, instead selectively returning the `code` property (`ERR_*`) or generic messages.
    - **Enhanced Logging**: Configured the logger to specifically capture Node.js native error properties (`err.code`, `err.syscall`, `err.path`), significantly improving observability and debugging capabilities for low-level I/O issues.

- **Friday, May 1 (Architecture & DDD)**: Applied insights from community discussions on Domain-Driven Design (DDD), Clean Architecture, and TDD in Node.js.
  - **Implemented Practices and Recommendations:**
    - **Original Sources Over Translations**: Avoid overly specific "Node.js translations" of architectural patterns. Prioritize original, seminal sources (e.g., Eric Evans' DDD book, Scott Wlaschin's "Domain Modeling Made Functional") to prevent concept distortion.
    - **Node.js Paradigms vs. Traditional OOP**: Avoid blindly importing heavy OOP concepts (like strict CQRS) into Node.js. Instead, leverage Node's native Event-Driven Architecture and consider its single-threaded nature (delegating heavy processing to workers/clustering) to ensure scalability.
    - **Type-Driven Development**: In TypeScript projects, leverage the type system to convey business rules, keeping unit tests focused on validation and behavior rather than being the sole source of truth.
    - **Recommended References**: 
      - **Khalil Stemmler's Blog**: Excellent starting point for applying Use-Case/Interactor-based Clean Architecture in Node.js/TypeScript.
      - **Repositories**: Explore reference implementations like `Sairyss/domain-driven-hexagon` or `ddd-by-examples`, but apply critical thinking and adapt them to Node.js strengths.

- **Friday, May 1 (Node.js API Documentation & Ecosystem Understanding)**: Applied insights from [Node.js Official Documentation Guide](https://nodejs.org/docs/latest/api/documentation.html)
  - **Implemented Practices in the Architecture:**
    - **Stability Index Auditing**: Enforced the practice of documenting the stability index of native Node.js modules used in the codebase. For instance, `node:sqlite` is explicitly tagged as `Stability: 1 - Experimental`, while `node:fs` and `node:path` are tagged as `Stability: 2 - Stable`. This improves maintainability by alerting developers to APIs that might suffer breaking changes in future Node.js releases without following SemVer.
    - **System Calls & Man Pages Awareness**: Acknowledged in error handling (`errorHandler.ts`) that Node.js system errors are direct wrappers around underlying OS system calls. Improved debugging traceability by explicitly referencing that properties like `syscall` map directly to Unix `man` pages.
    - **Programmatic Documentation Access**: Recorded that every `.html` Node.js documentation page has a corresponding `.json` endpoint (e.g. `documentation.json`), opening the door for programmatic consumption by IDEs or our internal AI tools in the future.

- **Friday, May 1 (Refactoring to Clean Architecture)**: Applied the Interactor/Use-Case pattern (as recommended in DDD/Clean Architecture for Node.js) to the `GenAI-Scaffold` API gateway.
  - **Implemented Practices in the AI Gateway (`packages/api`):**
    - **Use Case Isolation**: Refactored `src/models/modelHandlers.ts` by extracting all business and domain logic (model invocation, metadata preparation, data assembly) into dedicated Use Case classes (`InvokeModelUseCase`, `GetModelInfoUseCase`, `ListModelsUseCase`) located in `src/models/useCases/`.
    - **Thin Controllers**: Reduced Express controllers to their fundamental role in the "Web" layer: unpacking the HTTP `Request`, mapping it to a framework-agnostic DTO (Data Transfer Object), dispatching it to the corresponding Use Case, and mapping the generic result back to an HTTP `Response`.
    - **DTO Validation Boundary**: Enforced a strict boundary where data crossing from the external HTTP layer to the domain layer is structured into explicit interfaces (e.g., `InvokeModelDTO`).

- **Friday, May 1 (Security Hardening)**: Applied knowledge from [Node.js Security Best Practices](https://nodejs.org/learn/getting-started/security-best-practices).
  - **Implemented Practices in the AI Gateway (`packages/api`):**
    - **Mitigating CWE-400 (Denial of Service)**: Explicitly configured standard HTTP timeout limits on the native `node:http` server in `server.ts` (`headersTimeout`, `requestTimeout`, `timeout`, `keepAliveTimeout`). This prevents "Slowloris" type attacks and socket exhaustion by dropping slow or idle connections.
    - **Mitigating CWE-444 (HTTP Request Smuggling)**: Created the server with `{ insecureHTTPParser: false }` to ensure Node.js strictly adheres to HTTP specifications (RFC7230) when parsing incoming requests, protecting the proxy-to-backend boundary.
    - **Mitigating CWE-208 (Timing Attacks)**: Refactored the API Key validation logic in `apiKeyAuth.ts`. Instead of standard string comparison (`===`), which returns early on mismatch and exposes password lengths to timing attacks, we now compare lengths explicitly and use `node:crypto`'s `timingSafeEqual(Buffer, Buffer)` for a constant-time cryptographic verification of the keys.

- **Friday, May 1 (Node.js Design Patterns)**: Applied structural and behavioral patterns from the book *"Node.js Design Patterns"* (Mario Casciaro and Luciano Mammino) to enforce a robust, decoupled, and production-ready architecture using pure Node.js native features.
  - **Implemented Practices in the AI Gateway (`packages/api`):**
    - **Singleton & Proxy Patterns (`src/services/db.ts`)**: Encapsulated the `DatabaseSync` instantiation within a strict `DatabaseService.getInstance()` to avoid multiple connections. Wrapped the SQLite connection with a native `Proxy` to intercept `.prepare` and `.exec` methods, allowing transparent telemetry and query logging without modifying the original logic.
    - **Observer Pattern / EventEmitter (`src/server.ts`, `src/services/db.ts`)**: Decoupled systems by having the `Server` and `DatabaseService` extend `node:events` `EventEmitter`. The server now observes database query events asynchronously, eliminating tight coupling between the web layer and the persistence observability layer.
    - **State Pattern (`src/server.ts`)**: Addressed potential race conditions during server startup and shutdown by implementing an explicit `ServerState` ('STOPPED', 'STARTING', 'RUNNING', 'STOPPING'). This enforces a strict lifecycle state machine.
    - **Graceful Shutdown Pattern (`src/server.ts`)**: Handled operating system signals (`SIGINT`, `SIGTERM`) to trigger a controlled sequence: refusing new HTTP requests, finishing pending ones, securely closing the database connections, and exiting with code `0`.
    - **Template Method Pattern (`src/core/UseCase.ts`)**: Standardized the execution of use cases across the application. Created an abstract `UseCase` class with a sealed `execute()` method that handles `AsyncLocalStorage` tracing, performance timing, and standard error handling, while delegating the core business logic to the `executeImpl()` abstract method (e.g., implemented in `ListModelsUseCase`).

- **Friday, May 1 (Tao of Node - Observability & Configuration)**:
  - **Structured Logging**: Created a centralized structured JSON logger (`src/core/logger.ts`) to replace scattered `console.log` and `console.error` calls. This ensures all application logs, from request middleware to domain Use Cases and third-party API plugin integrations, output unified, parseable JSON payloads that include contextual `traceId` (via `async_hooks`) for distributed tracing.
  - **Configuration Encapsulation**: Created a central `src/core/config.ts` to encapsulate all `process.env` access, providing a typed, hierarchical configuration object (`config.server`, `config.env`) instead of reading environment variables ad-hoc throughout the codebase, adhering to the "Use hierarchical config" principle from the Tao of Node.

- **Friday, May 1 (Advanced AI Gateway Patterns - Native APIs)**: Applied advanced architectural features for High Performance, Resilience, and Observability without relying on third-party dependencies.
  - **Implemented Practices in the AI Gateway (`packages/api`):**
    - **Streaming and Server-Sent Events (SSE)**: Added a native streaming controller (`createStreamController` in `modelController.ts` and `POST /models/:modelId/stream`) leveraging `node:stream` concepts and `text/event-stream` headers. This is crucial for returning LLM responses incrementally (chunk-by-chunk) to minimize Time To First Byte (TTFB) without bloated external packages. 
      - *Reference*: [Node.js Stream API](https://nodejs.org/docs/latest/api/stream.html)
    - **Worker Threads (`node:worker_threads`)**: Implemented a Worker Pool pattern (`cpuWorker.ts` and `workerPool.ts`) to offload CPU-intensive operations (e.g., parsing massive JSON payloads, or synchronous cryptography) from the main Event Loop. This ensures the Gateway remains highly reactive and avoids single-thread bottlenecks. 
      - *Reference*: [Node.js Worker Threads API](https://nodejs.org/docs/latest/api/worker_threads.html)
    - **Native In-Memory Rate Limiting**: Created a lightweight Rate Limiter middleware (`rateLimiter.ts`) using the native `Map` structure with sliding window and TTL logic. This protects the AI endpoints from abuse and limits costly LLM API consumption without relying on an external Redis instance. 
      - *Reference*: [MDN Global Objects - Map](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map)
    - **Health Checks & Readiness Probes**: Implemented standard Liveness (`/health/live`) and Readiness (`/health/ready`) endpoints in `server.ts`. These endpoints utilize the underlying `ServerState` machine to assert that the service is actually ready to receive traffic (DB connected, plugins loaded), essential for Kubernetes or Docker environments. 
      - *Reference*: [Kubernetes Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
    - **Native Mocking (`node:test`)**: Documented and implemented Chaos Engineering tests (`mocking.test.ts`) using built-in `node:test` features such as `t.mock.method()` and `mock.timers()`. This natively validates the Gateway's resilience against third-party network failures, timeouts, and *Graceful Degradation* scenarios without requiring `jest` or `sinon`. 
      - *Reference*: [Node.js Test Mocking API](https://nodejs.org/docs/latest/api/test.html#mocking)

- **Friday, May 1 (Full-Stack Performance & Native Modernization)**: Expanded the architecture to achieve maximum performance and observability using native features.
  - **Implemented Practices in the AI Gateway (`packages/api`):**
    - **Recursive Agentic Tool Calling via Worker Threads**: Extracted the tool execution loop (`invoke-model.usecase.ts`) into a dedicated `toolWorker.ts` utilizing `node:worker_threads`. This prevents complex JSON parsing and parallel tool execution from blocking the main event loop, enabling highly concurrent agentic workflows.
      - *Reference*: [Node.js Worker Threads API](https://nodejs.org/docs/latest/api/worker_threads.html)
    - **Semantic Caching with SQLite & Crypto**: Implemented a native caching layer in `db.ts` utilizing `node:crypto` to hash LLM queries. This allows exact-match and semantic retrieval directly from the SQLite database, drastically reducing latency and external API costs.
      - *Reference*: [Node.js Crypto API](https://nodejs.org/docs/latest/api/crypto.html)
    - **Native OTLP Telemetry via Fetch**: Integrated OpenTelemetry span exportation natively using the built-in `fetch` API in `logger.ts`, avoiding heavy third-party auto-instrumentation SDKs while maintaining observability standards.

  - **Implemented Practices in the Frontend (`packages/client`):**
    - **Generative UI via Dynamic Injection**: Developed `dynamic-tool-renderer.ts` to dynamically render standalone Angular components on-the-fly based on AI tool responses, enabling a rich, decoupled AI-driven UI.
    - **INP Optimization & Main-Thread Yielding**: Incorporated `scheduler.yield()` strategies within heavy UI update cycles to free the main thread, directly optimizing the Interaction to Next Paint (INP) core web vital.
    - **Native CSS Render Optimizations**: Adopted `content-visibility: auto` in component stylesheets to defer rendering of off-screen elements. Modernized accessibility and overlays using native `focus-visible` and the HTML Popover API, eliminating the need for heavy UI libraries.

- **Friday, May 1 (AI Model Selection Strategy)**: Defined the model routing strategy for the AI Gateway to optimize TTFT (Time To First Token), strict JSON schema compliance, and cost-efficiency.
  - **Implemented Practices in the AI Gateway (`packages/api`)**:
    - **Frontier Models (Generative UI & Orchestration)**: Selected **Claude 3.5 Sonnet** as the primary engine for dynamically generating Angular UI components due to its superior JSON structuring. Selected **Gemini 1.5 Flash** as the core recursive orchestrator to aggressively reduce latency and costs via its native *Context Caching* during long tool-calling loops.
    - **Local SLMs (Edge Routing & Validation)**: Designated **Llama 3.1 (8B)** for zero-latency initial routing and **Phi-3.5 Mini** for asynchronous background validation (e.g., prompt injection detection) running directly in Node.js *Worker Threads* to protect paid API quotas.
    - **Embeddings & RAG**: Prioritized **Nomic Embed Text** running locally via WebAssembly/C++ bindings to populate the `node:sqlite` semantic cache without external network calls.
    - **Multimodal Inputs**: Planned integration of **Whisper-v3/Turbo** over the native WebSocket layer for real-time Voice-to-Text, and Vision models (Claude/Gemini) to support *Wireframe-to-UI* generation directly from the Angular client.

- **Friday, May 1 (Advanced Agentic Patterns - Batch 2)**:

  - **Implemented Practices in the AI Gateway (`packages/api`):**

    - **Patrón 1 — JIT Tool Search (`src/application/useCases/tool-search.usecase.ts`, `src/api/routes/toolRoutes.ts`, `src/infrastructure/database/db.ts`)**: Replaced the static tool-schema injection in the System Prompt with a native `search_tools` discovery mechanism. A `tools` table is created in SQLite on startup. The LLM emits `tool_use: { name: "search_tools" }` → the agentic loop calls `ToolSearchUseCase` → schemas are injected **at the END** of the context window, keeping the static System Prompt prefix immutable and guaranteeing 100% cache hits on Anthropic/OpenAI. Expected impact: up to −31% TTFT and up to −85% token costs via prompt caching.
      - *Reference*: [`node:sqlite` API](https://nodejs.org/docs/latest/api/sqlite.html) · [Anthropic Prompt Caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
      - *Endpoints added*: `POST /api/tools/search` · `GET /api/tools/:name` · `POST /api/tools/register`

    - **Patrón 5 — AsyncLocalStorage Extendido para Árboles Agenticos (`src/core/async-context.ts`)**: Extended `RequestContext` from a flat `{ traceId }` to a full agentic span tree: `{ traceId, spanId, parentSpanId?, depth, toolCallStack[] }`. Added `createRootContext()` (called once per HTTP request) and `createChildContext(toolName, parentCtx)` (called inside Worker Thread handlers). The child context is now serialized into `workerData` in `CPUWorkerService.executeTool()`, enabling full span-tree reconstruction in any OTLP collector (Jaeger, Grafana Tempo) without any prop-drilling or function-signature pollution.
      - *Reference*: [Node.js `async_hooks` API](https://nodejs.org/docs/latest/api/async_hooks.html) · [OpenTelemetry Span Hierarchy](https://opentelemetry.io/docs/concepts/signals/traces/)

    - **Patrón 4 — Declarative SSE Stream via AiStreamService + Signals (`packages/client/src/app/core/services/ai-stream.service.ts`)**: Replaced the imperative `for await` SSE loop, manual `isStreaming` / `streamTrigger` signals, and direct `SseService` injection in `text-model.ts` with a centralized `AiStreamService`. The service encapsulates the full SSE lifecycle (fetch + AbortController + chunk parsing + error handling) behind four read-only Signals (`isStreaming`, `streamText`, `streamError`, `hasStreamContent`). Components call `aiStream.startStream()` — one line — and read reactive state. Added a `streaming` render state to `<app-model-response>` with a native CSS blinking caret (`@keyframes caret-blink`) — zero JS animation loop. Stream cancel on route navigation is handled via `ngOnDestroy → aiStream.cancelStream()`.
      - *Reference*: [Web Streams API](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API) · [Angular Signals](https://angular.dev/guide/signals) · [AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
      - *Files changed*: `ai-stream.service.ts` (new) · `text-model.ts` (refactored) · `text-model.html` (declarative) · `model-response.ts` (streaming inputs) · `model-response.html` (live view) · `model-response.scss` (CSS caret animation)

    - **Patrón 2 — Servidor Nativo MCP (`src/infrastructure/mcp/`)**: Implemented a zero-dependency Model Context Protocol server exposing the Gateway's capabilities via two transports. **stdio transport** (`npm run mcp:stdio`): reads newline-delimited JSON-RPC 2.0 from stdin/stdout using `node:readline` — compatible with Claude Desktop, Cursor, Zed, and Continue.dev. **SSE transport** (`GET /mcp/sse` + `POST /mcp/message`): reuses the existing `text/event-stream` infrastructure with an in-memory `Map` of session connections. MCP capabilities: `tools/list` (reads from SQLite Tool Registry, Patrón 1), `tools/call` (delegates to Worker Pool), `resources/list|read` (exposes models, logs, tools registry), `prompts/list|get` (reusable interaction templates). Both transports seed `AsyncLocalStorage` root contexts per message (fully Patrón 5 compatible).
      - *Reference*: [MCP Spec v2024-11-05](https://spec.modelcontextprotocol.io/) · [Node.js readline API](https://nodejs.org/docs/latest/api/readline.html)
      - *Files created*: `mcp.types.ts` · `mcp-handlers.ts` · `mcp-server.ts`
      - *Config*: `package.json` script `mcp:stdio` added · SSE router mounted at `/mcp` in `server.ts`

- **Saturday, May 2 (Enterprise Grade Gateway Features)**: Implemented production-ready scaling, governance, and observability features to transition the scaffold into an Enterprise AI Gateway.
  - **Implemented Practices in the AI Gateway (`packages/api`)**:
    - **Token-based Rate Limiting (P1)**: Implemented an injectable `TokenStore` interface and `InMemoryTokenStore` (using native `Map` and `setInterval` garbage collection to avoid Redis dependency). Created `tokenRateLimiter` middleware to intercept API requests and consume precise token quotas *after* LLM responses (by reading `usageMetadata`), effectively protecting LLM budgets rather than just raw HTTP request counts.
    - **OpenTelemetry for TTFT (Time To First Token) (P1)**: Instrumented the `streamController` using native `node:perf_hooks` (`performance.now()`). Captures the exact millisecond delta between request start and the first Server-Sent Event (SSE) flush. The metric is natively logged and pushed down the stream payload (`{ metadata: { ttft_ms: X } }`) for client-side rendering.
    - **Semantic Caching with sqlite-vec (P2)**: Verified the complete implementation of the `semanticCache.lookup()` inside `InvokeModelUseCase`. The system embeds user prompts to L2 distance via `sqlite-vec` (int8 quantized) prior to calling the LLM API. This guarantees a Tier 1 semantic match (ignoring whitespace/paraphrasing) before falling back to the Tier 2 exact SHA-256 hash match, minimizing TTFT to 0ms and tokens cost to 0 for frequent queries.
    - **RBAC per Model Tiers (P3)**: Created an Express `rbacModelMiddleware` using the *Fail-Fast* pattern. It prevents unprivileged users (e.g., `free` tier) from waking up premium models (e.g., `gemini-1.5-pro` or `gemini-image-gen`) by matching the required tier from an internal map against the `req.user.tier` injected via the JSON Web Token.
