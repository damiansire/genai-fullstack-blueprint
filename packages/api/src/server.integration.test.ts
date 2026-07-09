// Integration test: boots the REAL composed Express app (all middleware wired)
// on an ephemeral port and drives it over HTTP. Unlike the unit tests — which
// exercise a single middleware/use-case in isolation — this proves the whole
// gateway wires together: health probes, the request/trace pipeline, the
// fail-closed auth boundary, and a full authenticated pass through the
// auth → limiter → token-limiter → safety → controller chain. No Gemini call is
// needed: `/api/models` only lists the registered plugins.
//
// The DB runs in-memory and the API keys are set here, so the test is
// hermetic — it does not touch the on-disk gateway.db or depend on env.example.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server } from './server.ts';

// Every request closes its socket, so `server.close()` in teardown never waits
// on an idle undici keep-alive connection (which on Windows could otherwise race
// `--test-force-exit` into a libuv close assertion).
const NO_KEEPALIVE = { connection: 'close' } as const;
const VALID_KEY = 'itest-key-abc123';

describe('Server — HTTP integration (real app, ephemeral port)', () => {
  let server: Server;
  let base: string;

  before(async () => {
    process.env['DB_PATH'] = ':memory:';
    process.env['PORT'] = '0'; // OS-assigned ephemeral port
    process.env['NODE_ENV'] = 'test';
    // Configure exactly one API key so the auth boundary is deterministic here,
    // independent of whatever env.example carries.
    process.env['API_KEY_1'] = `${VALID_KEY}:read,write`;

    server = new Server();
    await server.start();
    const port = server.getPort();
    assert.ok(port && port > 0, 'server should bind an ephemeral port');
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await server.stop();
  });

  it('GET /health/live returns 200 with a live status', async () => {
    const res = await fetch(`${base}/health/live`, { headers: NO_KEEPALIVE });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string };
    assert.equal(body.status, 'live');
  });

  it('GET /health/ready returns 200 once the server is RUNNING', async () => {
    const res = await fetch(`${base}/health/ready`, { headers: NO_KEEPALIVE });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; registeredModels: unknown };
    assert.equal(body.status, 'ready');
    assert.ok(Array.isArray(body.registeredModels), 'ready payload lists registered models');
  });

  it('GET /api/info reports the gateway identity and model count', async () => {
    const res = await fetch(`${base}/api/info`, { headers: NO_KEEPALIVE });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { name: string; totalModels: number };
    assert.equal(body.name, 'AI Gateway API');
    assert.ok(Number.isInteger(body.totalModels), 'totalModels is a number');
  });

  it('stamps an X-Trace-Id response header on every request', async () => {
    const res = await fetch(`${base}/health/live`, { headers: NO_KEEPALIVE });
    assert.match(
      res.headers.get('x-trace-id') ?? '',
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('unknown routes return a 404 JSON envelope (not an HTML stack)', async () => {
    const res = await fetch(`${base}/definitely-not-a-route`, { headers: NO_KEEPALIVE });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string; path: string };
    assert.equal(body.error, 'Route not found');
    assert.equal(body.path, '/definitely-not-a-route');
  });

  it('a protected /api route rejects an unauthenticated request (fail-closed auth)', async () => {
    const res = await fetch(`${base}/api/models`, { headers: NO_KEEPALIVE });
    assert.equal(res.status, 401, 'no X-API-Key must be rejected, never served');
  });

  it('the same route succeeds end-to-end with a valid API key (auth → limiter → safety → handler)', async () => {
    const res = await fetch(`${base}/api/models`, {
      headers: { ...NO_KEEPALIVE, 'x-api-key': VALID_KEY },
    });
    assert.equal(res.status, 200, 'a valid key passes the full middleware chain');
    const body = await res.json();
    // The controller lists the registered model plugins; shape is an array or a
    // wrapper containing one. We only assert it responded with JSON data, not an
    // error envelope — the point is the chain ran to the handler and back.
    assert.ok(body && typeof body === 'object', 'handler returned a JSON payload');
  });
});
