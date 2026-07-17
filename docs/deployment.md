# Deployment status

Honest status of "can this be deployed", split into what is verified today and
what a real public demo still needs.

## What IS verified today: the full stack boots healthy from Docker Compose

`docker-compose.yml` (root) defines two services, `api` (`.docker/Dockerfile.server`,
port 3000) and `client` (`.docker/Dockerfile.client`, nginx, port 8080), on a
shared bridge network, each with a real healthcheck (not just "container is
running" - `curl`/`http.get` against a live endpoint).

This is exercised end-to-end on **every push and PR** by the `docker-smoke` job
in `.github/workflows/ci.yml`, which runs the checked-in [`scripts/smoke.sh`](../scripts/smoke.sh):

1. `cp env.example .env` (the example placeholders are enough to boot: health
   and `/api/info` need no real secrets).
2. `docker compose up -d --build --wait --wait-timeout 240` - builds both images
   from the shipped Dockerfiles and waits for both healthchecks to pass.
3. Smoke-tests: `GET /health/live` returns `"status":"live"`, `GET /api/info`
   mentions `AI Gateway API`, and the client SPA at `/` returns HTTP 200.
4. `docker compose logs` is dumped on failure, then `docker compose down -v`
   always runs.

So "does the Docker Compose stack boot sane end to end" already has a real,
reproducible, continuously-run answer: yes, CI proves it on every change, and
`docker compose logs`/tear-down happen automatically either way.

**This session's own attempt to re-verify that locally**: `docker --version`
was checked in this environment (Windows machine, this Claude Code session) and
Docker is **not installed here** (`docker: command not found` on the shell
PATH). This session could not independently re-run `docker compose up` as a
second, local confirmation - the evidence above is CI's, not this session's.
If Docker is available, reproduce the same check locally by running the exact
script CI runs (it seeds `.env` from `env.example` if missing):

```bash
bash scripts/smoke.sh --down   # boot the stack, smoke-test every endpoint, tear down
```

That is equivalent to, and the single source of truth for, the manual sequence:

```bash
cp env.example .env
docker compose up -d --build --wait --wait-timeout 240
curl -fsS http://localhost:3000/health/live
curl -fsS http://localhost:3000/api/info
curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:8080/
docker compose down -v
```

## What is NOT done: a real hosted demo environment

Nothing above is a public URL - it is a local/CI-only compose stack. A real demo
deployment needs decisions this repo does not make on its own, and this
session was explicitly told not to guess at them:

- **Hosting provider** (Cloud Run, Fly.io, a VPS, ECS, etc.) - not chosen.
- **Domain** and TLS termination - not chosen/provisioned.
- **Secrets management** in that environment (`GEMINI_API_KEY`, `OPENAI_API_KEY`,
  `API_KEY_*`) - the compose file's `env_file: .env` pattern is fine for local
  dev; a hosted deploy needs a real secrets store (the provider's own secret
  manager, not a `.env` file baked into an image).
- **Persistent storage** for the SQLite-backed caches/rate-limit store
  (`infrastructure/database/db.js`) if the demo needs to survive
  restarts/redeploys - currently a bind-mounted `./logs` volume only, no
  managed volume/DB story for a multi-instance or ephemeral-filesystem host.
- Multi-instance rate limiting is explicitly out of scope today (see
  `docs/load-test.md`'s non-goals) - relevant if the chosen host scales the
  `api` service beyond one instance.

Deploying to a real cloud target without those decisions would mean guessing
at infrastructure Damian did not ask for. The maximum honest scope for this
pass was: confirm the compose stack's health is already continuously verified
(it is, via CI), and document precisely what remains to turn that into a public
demo.
