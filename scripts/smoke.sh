#!/usr/bin/env bash
#
# Smoke-test the full Docker Compose stack: build both images from the shipped
# Dockerfiles, wait for both healthchecks to report healthy, then hit every
# live endpoint the README declares. Exits non-zero (and dumps compose logs) if
# any container fails to become healthy or any endpoint does not answer as
# expected. This is the single source of truth for the README's "boots to
# healthy, with its live endpoints smoke-tested" claim: CI runs this exact
# script on every push/PR (see .github/workflows/ci.yml, job docker-smoke).
#
#   scripts/smoke.sh            bring the stack up and smoke-test it
#   scripts/smoke.sh --down     also tear the stack down (compose down -v) at the end
#
# Requires: Docker + Docker Compose v2. Run from the repo root.
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"
CLIENT_BASE="${CLIENT_BASE:-http://localhost:8080}"
WAIT_TIMEOUT="${WAIT_TIMEOUT:-240}"
TEARDOWN=0
[ "${1:-}" = "--down" ] && TEARDOWN=1

dump_logs() {
  echo "::group::compose logs (smoke failure)" >&2 || true
  docker compose logs --no-color >&2 || true
  echo "::endgroup::" >&2 || true
}
trap dump_logs ERR

# compose needs an env file (env_file: .env) and values for ${...} interpolation.
# The env.example placeholders are enough to boot: health and /api/info need no
# real secrets (Gemini is only called on real invoke requests).
if [ ! -f .env ]; then
  echo "smoke: no .env found, seeding from env.example"
  cp env.example .env
fi

echo "smoke: building images and starting the stack (wait up to ${WAIT_TIMEOUT}s for healthchecks)"
docker compose up -d --build --wait --wait-timeout "${WAIT_TIMEOUT}"

echo "smoke: API liveness -> ${API_BASE}/health/live"
curl -fsS "${API_BASE}/health/live" | grep -q '"status":"live"'

echo "smoke: API readiness -> ${API_BASE}/health/ready"
curl -fsS "${API_BASE}/health/ready" | grep -q '"status":"ready"'

echo "smoke: API info (free, no-auth, no-Gemini) -> ${API_BASE}/api/info"
curl -fsS "${API_BASE}/api/info" | grep -q 'AI Gateway API'

echo "smoke: client SPA served by nginx -> ${CLIENT_BASE}/"
test "$(curl -fsS -o /dev/null -w '%{http_code}' "${CLIENT_BASE}/")" = "200"

echo "smoke: client health -> ${CLIENT_BASE}/health"
test "$(curl -fsS -o /dev/null -w '%{http_code}' "${CLIENT_BASE}/health")" = "200"

trap - ERR
echo "smoke: OK - all declared endpoints answered healthy"

if [ "${TEARDOWN}" = "1" ]; then
  echo "smoke: tearing down the stack"
  docker compose down -v
fi
