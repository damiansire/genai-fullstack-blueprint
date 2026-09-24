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
- `packages/client` — Angular 22 frontend. Standalone components, Signals,
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

<!-- ALLOW_PUBLIC: barra de construcción del repo, con provenance OSS público. -->

## Estándar nivel mundial

Esta sección es la barra contra la que se CONSTRUYE este repo, no contra la que se
audita al final. Se aplica antes de escribir una feature, no después.

Cada regla cita el repo OSS del que sale (provenance público, verificable). Nada de
acá es invención local: una regla sin provenance no es regla. Los stacks que aplican
a este repo son `genai`, `angular` y `node-ts`, más los transversales de arquitectura
y TypeScript.

### Piso Craft (a-j), obligatorio, se marca violado con `file:line`

Regla raíz, Intención Clara / Zero-Guessing: el código debe ser tan evidente que un
senior entienda el porqué sin preguntar ni ejecutarlo.

- **a. El nombre revela la intención de DOMINIO, no el mecanismo.** Nada de
  `data`, `handle`, `manager`, `process` donde el dominio tiene un término.
- **b. Los comentarios explican POR QUÉ, nunca QUÉ.** Un comentario que parafrasea
  el código es señal de que hay que renombrar o extraer, no de que falte comentario.
  *(provenance: `angular/components`, CODING_STANDARDS.md)*
- **c. Superficie pública autodocumentada.** La firma comunica el contrato sin leer
  el cuerpo. Si hay que ejecutar para saber qué hace una API pública, está violado.
- **d. Impacto mínimo al cambiar el core.** Cambiar una regla no puede exigir editar
  N sitios acoplados. El mismo literal o branch repetido es la señal a grepear.
- **e. Features borrables sin cirugía.** Sin God-objects ni estado global que varios
  módulos mutan. Quitar una feature no deja tentáculos.
- **f. Flujo de datos inmutable y rastreable.** El estado se deriva, no se muta a
  escondidas.
- **g. Consistencia ante excepción.** Si algo falla, el estado queda consistente o
  recuperable, nunca a medias. Sin escritura parcial sin rollback.
- **h. Los boundaries comunican lo que pasa.** Log o métrica estructurada en cada
  entrada, fallo y decisión. Acá eso significa `AsyncLocalStorage` con `traceId`:
  todo boundary nuevo (ruta, worker, cola, transporte MCP) loguea con ese `traceId`,
  nunca un `console.log` suelto.
- **i. Límites explícitos: timeouts, reintentos acotados, circuit-breaking.** Ninguna
  llamada externa sin timeout, ningún reintento o polling sin tope.
- **j. Fail-closed donde importa.** Ante duda de seguridad o permisos, denegar. La
  rama por defecto o sin match de TODA decisión de autorización deniega. En este repo
  la postura (fail-closed, o fail-open deliberado) se documenta EN EL PROPIO CÓDIGO,
  no en un doc aparte: ver `apiKeyAuth.ts` (fail-closed sin keys) y
  `ai-safety.middleware.ts` (fail-open deliberado del classifier, con el comentario
  explicando el tradeoff). Un comentario que declara fail-closed sobre código que
  falla abierto es peor que no tener comentario: es una garantía falsa.

### Legibilidad en frío (k-m): el artefacto demuestra su propósito sin leer código

Cluster distinto de Craft. Ataca un modo de falla concreto: quedar SUB-descripto, no
inflado. Chequeable al hojear, en ~30s, sin abrir el código.

- **k. El README lidera con prueba visible + framing honesto.** Captura, GIF o
  code-example en el primer screenful, y un statement claro de qué-es y para-quién.
  Este repo tiene un cliente Angular renderizado: para un artefacto VISUAL, la
  descripción textual NO cuenta como prueba visible.
  *(provenance: GitLab OSS guide, GitHub README 5-part)*
- **l. Donde prometés robustez o performance, la prueba está y es reproducible.**
  Todo número (throughput, latencia, tokens/seg, conteo de tests) sale de un script
  reproducible gateado en CI, nunca tipeado a mano. El patrón ya es el estándar del
  repo: `scripts/update-metrics.mjs --check` para los conteos y `docs/load-test.md`
  para la carga medida. Un claim nuevo de número sin su script es una violación, no
  una omisión.
  *(provenance: ripgrep benchsuite, TechEmpower)*
- **m. Framing honesto: reconocés el sesgo propio y el límite del claim.** El README
  declara qué NO cubre (hoy: deployment con SLA, pentest formal, fuzzing
  adversarial). Al sumar una capa nueva se actualiza esa lista en el mismo commit,
  en vez de dejarla stale.
  *(provenance: ripgrep, "not universally faster… on small files negligible")*

### Techo de Craft: lo que mueve de "correcto" a "referencia"

Idea rectora: los repos de referencia convierten la calidad en **hecho
machine-enforced**, no en convención escrita.

- **Nombres y superficie (a, c):** imposible-de-malusar, no solo legible. Un único
  contrato de boundary bien especificado, con la precondición codificada en el tipo.
  *(provenance: type-state-builder, LLVM)*
- **Encapsulamiento (d, e):** el boundary es un hecho de CI, no un acuerdo. Allowlist
  de imports default-deny chequeada en el pipeline.
  *(provenance: Kubernetes import-boss, LLVM)*
- **Integridad de estado (f, g):** invariante observable Y fault-injected. Un `assert`
  es PRUEBA (verificada en todos los tests), separado de lo meramente creído;
  ejercitado con inyección de fallas.
  *(provenance: SQLite, PostgreSQL)*
- **Resiliencia, reintentos (i):** cap exponencial finito + **jitter obligatorio** +
  stop por **presupuesto de tiempo**, con UN presupuesto por llamada (no reintentos
  anidados por capa) y reenvío del budget restante, no uno fresco por hop.
  *(provenance: AWS Builders' Library, cenkalti/backoff, gRPC, Go context)*
- **Resiliencia, fail-closed (j):** los límites de carga son campos de config
  EXPLÍCITOS y nombrados (`max_requests`, `consecutive_5xx`), nunca implícitos.
  *(provenance: Kubernetes RBAC `DecisionNoOpinion`, Rego `default allow := false`, Envoy)*

Regla de aplicación: distinguí "gateable por linter o CI" (regla dura, va al gate) de
"criterio de review" (juicio humano). Escribir la regla y no gatearla es exactamente
el modo de falla que este repo ya sufrió.

### Reglas enforzables del stack

#### genai

- **Adapter multi-proveedor por contrato VERSIONADO.** El core depende de la
  interfaz (`IModelStrategy`), nunca del SDK concreto de un proveedor; el número de
  versión va en el nombre del tipo para poder romper el contrato de forma
  controlada. Sumar un proveedor no toca el core.
  *(provenance: `vercel/ai`, `LanguageModelV4`/`ProviderV4`; `promptfoo`, `ApiProvider`)*
- **Retry header-aware, no backoff a ciegas.** Primero se lee `retry-after-ms` o
  `retry-after` del proveedor, con clamp a [0, 60s), y recién se cae al backoff
  exponencial. Un abort NUNCA se reintenta (primer chequeo del catch), y la
  reintentabilidad se decide al CONSTRUIR el error, en la capa de respuesta
  (`isRetryable`), no en el retry genérico.
  *(provenance: `vercel/ai`, `retry-with-exponential-backoff.ts` + `response-handler.ts`)*
- **`JSON.parse` crudo prohibido en el camino de producción.** La respuesta del
  modelo se parsea con un helper validado por schema (`safeParseJSON` con zod). Es
  gateable como `no-restricted-syntax` de ESLint.
  *(provenance: `vercel/ai` AGENTS.md, "JSON.parse prohibido en prod")*
- **SSE tipado por evento, no string crudo.** El stream transporta un union
  discriminado (texto, reasoning, tool-call, usage, traceId) y el cliente hace
  `switch` sobre el tipo, no parsing ad-hoc. El contrato de wire se pinnea con un
  test de round-trip servidor a parser-de-cliente.
  *(provenance: `lobehub/lobe-chat`, `fetchSSE.ts`; skill local `.agents/skills/streaming-render`)*
- **Render de stream por rAF, nunca `set()` por chunk.** Cola de chars drenada en
  `requestAnimationFrame` a velocidad adaptativa, con `flushQueue()` en abort y en
  finish. La ganancia adaptativa va ACOTADA: una velocidad que puede volverse
  negativa congela el texto en pantalla.
  *(provenance: `lobehub/lobe-chat`, `createSmoothMessage`; skill local `streaming-render`)*
- **Cache key hygiene.** Nunca hashear secretos (stripear `Authorization` y API keys
  antes de armar la clave), canonicalizar ordenando claves antes de serializar, e
  incluir la identidad del caller en la clave: un cache de prompts sin
  `tenant`/`userId` en la clave filtra respuestas entre tenants. Marcar siempre
  `cached: true` al devolver del cache, para que downstream saltee rate-limit y las
  métricas distingan hit de llamada real.
  *(provenance: `promptfoo`, providers-AGENTS.md)*
- **Concurrencia acotada y poda de contexto.** Nada de `for...of` con `await`
  secuencial sobre N prompts sin dependencia de datos (throughput asfixiado), y nada
  de concatenar historial sin límite antes de mandar a la API (el costo escala
  cuadráticamente con el contexto). Lotes acotados + ventana rodante o resumen.
  *(provenance: vLLM, continuous batching y PagedAttention)*
- **Evals y benchmarks: declarativos, versionados y reproducibles.** Si se agrega una
  eval, va como dato declarativo con `metadata.version` y decoding explícito
  (`temperature: 0`), no como código, y el runner logea sus seeds. Dos corridas
  distintas tienen que dar el mismo número, o no es un benchmark.
  *(provenance: `EleutherAI/lm-evaluation-harness`, gsm8k.yaml + seeds del evaluator)*
- **Assert de eval = función pura con shape estable y `reason` humano.** El texto del
  `reason` es parte del contrato público: los tests comparan el objeto ENTERO, no
  solo `pass`. Y el parser de asserts se testea adversarialmente, no en happy path:
  en un evaluador, un assert que pasa por accidente es el peor bug posible.
  *(provenance: `promptfoo`, `contains.ts` + `contains.test.ts`)*

#### node-ts (el gateway)

- **tsconfig estricto CENTRALIZADO.** La barra de strictness vive en
  `tsconfig.base.json` en la raíz y los workspaces la extienden. Un tsconfig hoja que
  re-declara un flag de strictness es drift, y es greppable.
  *(provenance: Backstage `packages/cli/config/tsconfig.json`, `@directus/tsconfig`,
  `@n8n/typescript-config`)*
- **Techo de strictness estilo Directus para código nuevo.**
  `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `noPropertyAccessFromIndexSignature`, `noImplicitOverride`. `packages/api` ya está
  ahí; `packages/client` es deuda declarada, no permiso: el código nuevo del client se
  escribe como si estuvieran prendidos.
  *(provenance: `directus/tsconfig` config node22)*
- **Typecheck como gate DEDICADO**, separado de build y de lint, sin
  `continue-on-error`. Ya lo cumple `npm run ci`.
  *(provenance: n8n job `Typecheck`, Backstage `tsc:full`)*
- **CI sin enmascaramiento de fallos.** Cero `continue-on-error` y cero `|| true` en
  los workflows. Una excepción deliberada se marca explícita y documentada, nunca
  tácita.
  *(provenance: n8n `ci-pull-requests.yml`, 0 ocurrencias en 420 líneas)*
- **Producción SIEMPRE buildeada o ejecutada con un runtime declarado.** El
  entrypoint de producción no depende de un transpilador ad-hoc no declarado.
  *(provenance: n8n, Backstage, Directus)*
- **Validación de env por schema con fail-fast al arranque.** Env inválido mata el
  proceso al bootear, no en la primera request. Refuerza el ítem j.
  *(provenance: n8n `@n8n/config` con zod, que reemplaza convict)*
- **Coverage con umbral que gatea.** `packages/api` corre `node --test` con
  `--test-coverage-lines/branches/functions`, coherente con "built-in over
  dependencies". El umbral es un ratchet: solo sube. **Honestidad de la cita:** el
  mecanismo está verificado, pero gatear coverage por umbral es elección propia de
  este repo, NO consenso OSS (ninguno de los repos de referencia lo hace). Se sostiene
  como barra propia, no se vende como "lo que hacen los top".
  *(provenance: mecanismo nativo de `node --test` y de vitest `coverage.thresholds`)*
- **Supply-chain determinista.** Actions de terceros pinneadas a SHA completo (no a
  tag mutable), lockfile sin duplicados como check, y allowlist de scripts de
  postinstall.
  *(provenance: n8n workflows, Backstage `verify-lockfile-duplicates.js`, Directus
  `onlyBuiltDependencies`)*

#### angular (el cliente)

- **`strictTemplates` + `typeCheckHostBindings` + `strictInputAccessModifiers`.** Ya
  prendidos: no se apagan para desbloquear un cambio.
  *(provenance: `angular/components`, tsconfig.json)*
- **Zoneless: la reactividad la dan signals y eventos, punto.** Sin Zone.js,
  `setTimeout`/`setInterval`/promesas NO disparan change detection. Un campo plano
  asignado desde un callback no actualiza la vista.
  *(provenance: docs oficiales de Angular, change detection y zoneless)*
- **Derivar con `computed`, nunca con un field initializer.** `valor = this.x()` en un
  campo captura un snapshot y no es reactivo: es el bug clásico. `effect` es para side
  effects, no para propagar estado a otro signal.
  *(provenance: idem, guía de signals)*
- **`[(ngModel)]` con un signal pelado está PROHIBIDO.** Bindea la referencia, pisa el
  signal, y después `x()` tira "is not a function"; `strictTemplates` no siempre lo
  atrapa. La forma correcta es `[ngModel]="x()" (ngModelChange)="x.set($event)"`.
  *(provenance: idem, two-way binding)*
- **APIs modernas y control flow nuevo:** `input()`, `output()`, `model()`,
  `viewChild()`, `@if` / `@for` (con `track` obligatorio) / `@switch`, `[class.x]`
  sobre `ngClass`. `OnPush` en todo componente, ya gateado por lint.
  *(provenance: idem)*
- **a11y como primitiva, no como atributo suelto.** Un `role="menu"` sin roving
  tabindex ni handlers de teclado no es accesible, es decorado. El patrón de
  referencia es `ListKeyManager` (roving tabindex, wrap, typeahead, home y end),
  `FocusTrap` para overlays y `LiveAnnouncer` para anuncios.
  *(provenance: `@angular/cdk/a11y` de `angular/components`)*
- **Tests de componente por harness, no por DOM interno**, para que sobrevivan un
  refactor de markup.
  *(provenance: `angular/components`, `component-harness.ts`)*
- **Ninguna llamada de red sale fuera de la capa de fetching declarada.** Cero
  `fetch(` crudo en features. Es gateable con un grep en CI.
  *(provenance: `lobehub/lobe-chat`, data-fetching-architecture SKILL; skill local
  `.agents/skills/data-fetching`)*

#### typescript (transversal)

- **`as Type` va de MAYOR a BLOCKER.** Equivale a apagar el compilador. En un boundary
  (respuesta del modelo, body de request) se usa validación runtime con zod o un type
  guard real, no un cast.
  *(provenance: tRPC, disciplina de type-safety extrema)*
- **`any` explícito es BLOCKER; lo desconocido se tipa `unknown`.** Hoy está en `warn`
  en ambos eslint configs como deuda rastreada: eso es una excepción con fecha de
  vencimiento, no la barra.
  *(provenance: TypeScript core, `any` contamina recursivamente)*
- **Exhaustividad con `never` en todo `switch` sobre union discriminado**, para que
  agregar una variante rompa la compilación en vez de caer en un default silencioso.
  *(provenance: idem)*

### Documentación

El README es parte del producto y se gatea igual que el código.

- **Nombra al proyecto igual que el manifest.** El `name` de `package.json`
  (`genai-fullstack-blueprint`), el título del README y la descripción del repo son
  la misma cosa. Un README que se refiere al proyecto con un nombre viejo o distinto
  es drift, y delata copia de otro repo.
  *(provenance: ítem k, "nombre y descripción = el contenido real")*
- **No linkea a archivos que no existen.** Todo link relativo apunta a un archivo
  presente en el repo. Está gateado por `.github/workflows/link-check.yml` (lychee con
  `fail: true`); el gate hoy cubre `README.md`, `REGISTRY.md` y `AGENTS.md`, así que al
  sumar un doc nuevo con links se lo agrega a esa lista en el mismo commit.
  *(provenance: ítem k; mecanismo local ya existente)*
- **No es un molde reciclado.** Prohibido dejar secciones genéricas heredadas de otro
  repo, features listadas en el README que el código no tiene, o endpoints
  documentados como estables que devuelven error siempre. Cada afirmación del README
  se corresponde con algo ejecutable, o se borra.
  *(provenance: ítems k y m; el antídoto de sub-describir y de sobre-vender es el
  mismo: que la doc describa lo que hay)*
- **El único doc canónico para agentes es este `AGENTS.md`.** `CLAUDE.md` y
  `GEMINI.md` son punteros de una línea. Guía nueva va acá, no duplicada allá.
  *(provenance: `lobehub/lobe-chat` y `promptfoo`, ambos con `CLAUDE.md` = `@AGENTS.md`)*
- **Todo número del README sale de un script.** Ver ítem l: regenerar con
  `node scripts/update-metrics.mjs`, nunca a mano.
