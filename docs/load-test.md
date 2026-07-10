# Load test + basic threat model

Este documento es un piso, no una auditoría de seguridad ni un soak test. Cubre
dos cosas medidas de verdad contra el server corriendo local (`npm run start
--workspace=api`, Node 24, sin Docker), y el modelo de amenazas informal que
explica por qué esos números son los esperados.

## Metodología

- Herramienta: [autocannon](https://github.com/mcollina/autocannon) v8.0.0 (vía `npx`).
- Entorno: Windows 11, Node v26.2.0, server local (`localhost:3000`), sin red externa.
- Reproducir:
  ```bash
  npm run start --workspace=api &
  npx autocannon -c 50 -d 15 -j http://localhost:3000/health/live
  npx autocannon -c 10 -a 150 -H "x-api-key: your-secure-api-key-1" -j \
    http://localhost:3000/api/domain/telemetry/devices
  ```

## Resultado 1 — baseline sin auth (`/health/live`, 50 conexiones, 15s)

| Métrica | Valor |
| --- | --- |
| Requests totales | 3,841 |
| RPS promedio | 256.07 |
| Latencia promedio | 194.11ms |
| Latencia p50 | 189ms |
| Latencia p97.5 | 287ms |
| Latencia p99 | 308ms |
| Latencia max | 351ms |
| Errores / timeouts / non-2xx | 0 / 0 / 0 |

Sin errores hasta 50 conexiones concurrentes contra el endpoint más liviano
(sin auth, sin DB, sin Gemini). Esto mide el techo del event loop de Express +
Node, no el techo del sistema completo (Gemini y SQLite no están en este path).

## Resultado 2 — el rate limiter frena en el número exacto configurado

`/api/domain/telemetry/devices` pasa por `apiKeyAuth → apiLimiter` (ver
`packages/api/src/server.ts:185-189`: `windowMs: 60_000, max: 100` por API key).
Burst de 150 requests autenticadas con la misma key, 10 conexiones concurrentes:

| Status | Count |
| --- | --- |
| 200 | 100 |
| 429 | 50 |

Exactamente 100 pasan y 50 se bloquean — el límite de 100 req/min por key no es
aspiracional, dispara en el número exacto bajo carga real concurrente (no solo
en un test secuencial de unidad).

## Threat model básico (boundaries reales, no exhaustivo)

| Boundary | Postura | Evidencia |
| --- | --- | --- |
| Sin ninguna API key configurada | **Fail-closed**: deniega todo | `packages/api/src/api/middleware/apiKeyAuth.ts:132` |
| Rate limit (100 req/min por key) | **Fail-closed**: 429 al superar el cupo | medido arriba, Resultado 2 |
| Token limit (50,000 tokens/min por key) | **Fail-closed** (mismo patrón que rate limit) | `packages/api/src/server.ts:191-195` |
| PII en el body (email, tarjeta) | Masking síncrono, siempre corre | `packages/api/src/api/middleware/ai-safety.middleware.ts:36-45` |
| Clasificación de prompt-injection/toxicidad | **Fail-OPEN deliberado**: si el worker de clasificación falla, la request pasa (el PII ya quedó enmascarado) | `packages/api/src/api/middleware/ai-safety.middleware.ts:15-22` (`FAIL_CLOSED = false`, documentado inline con el tradeoff) |
| Input de rutas `/api/*` | Validado con `zod` en el boundary (ver `AGENTS.md`) | — |

**Lectura del fail-open de la firewall de safety**: es una decisión de
disponibilidad explícita y documentada en el propio código (un classifier caído
no debe tumbar el gateway), distinta de auth/rate-limit que sí deniegan. Si el
caso de uso pide una postura más estricta, el propio comentario del archivo
indica el flag (`FAIL_CLOSED = true`) — no hace falta rediseñar nada, es un
toggle ya construido.

## Qué NO cubre esto (no-goals explícitos)

- Soak test (carga sostenida por horas) — esto es un burst de 15s.
- Carga contra Gemini real (los endpoints medidos no llaman al modelo).
- Rate limiting distribuido multi-instancia: el store persiste en SQLite
  (sobrevive restarts) pero no se probó con más de un proceso Node detrás de
  un load balancer.
- Pen-test formal / fuzzing adversarial del validador de safety.

Estas son las mismas capas que el README ya declara como "las agregás vos
arriba de este foundation" — este doc es el primer escalón medido, no el
techo.
