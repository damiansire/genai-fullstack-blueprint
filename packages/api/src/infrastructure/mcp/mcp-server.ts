/**
 * MCP Server — Patrón 2: Servidor Nativo MCP (Model Context Protocol)
 *
 * Implements TWO transports with ZERO external dependencies:
 *
 *   1. stdio transport  — for local MCP clients: Claude Desktop, Cursor, Zed, Continue.dev
 *      Each JSON-RPC message is a single newline-delimited JSON line on stdin/stdout.
 *      Start with: node --experimental-strip-types src/infrastructure/mcp/mcp-server.ts --stdio
 *
 *   2. SSE transport    — for web/remote MCP clients over HTTP.
 *      Uses the existing Express app and text/event-stream (already in the project).
 *      GET  /mcp/sse   → opens the SSE stream (server → client)
 *      POST /mcp/message → sends JSON-RPC messages (client → server)
 *
 * Architecture:
 *   - No @modelcontextprotocol/sdk — pure readline + EventEmitter + SSE headers
 *   - Handlers are in mcp-handlers.ts and wired to existing Gateway infra
 *   - AsyncLocalStorage context is seeded for every message (Patrón 5 compatible)
 *
 * Reference: https://spec.modelcontextprotocol.io/specification/basic/transports/
 */

// Stability: 2 - Stable (node:readline)
import { createInterface } from 'node:readline';
// Stability: 2 - Stable (node:crypto)
import { randomUUID } from 'node:crypto';
import { Router, Request, Response } from 'express';
import { requestContext, createRootContext } from '../../core/async-context.js';
import { logger } from '../../core/logger.js';
import { handleMcpRequest } from './mcp-handlers.js';
import type { JsonRpcRequest, JsonRpcResponse } from './mcp.types.js';
import { JSON_RPC_ERRORS } from './mcp.types.js';

// ─────────────────────────────────────────────────────────────────────────────
// TRANSPORT 1: stdio
// One JSON-RPC message per newline. Used by Claude Desktop, Cursor, Zed, etc.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Starts the MCP server in stdio mode.
 * Reads JSON-RPC requests line-by-line from stdin, writes responses to stdout.
 *
 * Design notes:
 *   - `process.stdin` is set to UTF-8 encoding before starting.
 *   - Responses are written with `process.stdout.write()` + newline delimiter.
 *   - Errors in parsing are returned as JSON-RPC parse errors (code -32700).
 *   - The process stays alive as long as stdin is open (i.e., the MCP client is connected).
 *   - Each message gets its own AsyncLocalStorage context for tracing (Patrón 5).
 */
export function startMcpStdioServer(): void {
  process.stdin.setEncoding('utf8');

  const rl = createInterface({
    input: process.stdin,
    terminal: false,
    crlfDelay: Infinity,
  });

  logger.info('[MCP/stdio] Server started. Waiting for messages...');

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed: JsonRpcRequest;

    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // JSON-RPC parse error — we don't have an id yet
      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: null,
        error: { code: JSON_RPC_ERRORS.PARSE_ERROR, message: 'Parse error: invalid JSON' },
      };
      process.stdout.write(JSON.stringify(response) + '\n');
      return;
    }

    // Seed AsyncLocalStorage for tracing (Patrón 5)
    const traceId = randomUUID();
    await requestContext.run(createRootContext(traceId), async () => {
      try {
        const response = await handleMcpRequest(parsed);

        // Notifications have no response (null is returned by the handler)
        if (response !== null) {
          process.stdout.write(JSON.stringify(response) + '\n');
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        const response: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: parsed.id ?? null,
          error: { code: JSON_RPC_ERRORS.INTERNAL_ERROR, message },
        };
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    });
  });

  rl.on('close', () => {
    logger.info('[MCP/stdio] stdin closed. MCP server shutting down.');
    process.exit(0);
  });

  // Unhandled rejection guard for the stdio process
  process.on('unhandledRejection', (reason) => {
    logger.error('[MCP/stdio] Unhandled rejection', { reason: String(reason) });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TRANSPORT 2: SSE (Server-Sent Events over HTTP)
// Used by web-based MCP clients or remote connections.
// Reuses the existing SSE infrastructure already in the project.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-memory registry of active SSE connections.
 * Maps sessionId → Express Response object.
 * Used by POST /mcp/message to push responses to the correct SSE stream.
 */
const sseClients = new Map<string, Response>();

/**
 * Sends a JSON-RPC response to a specific SSE client.
 * Formats the data as an SSE `data:` event per the text/event-stream spec.
 */
function sendSseEvent(res: Response, data: unknown): void {
  const json = JSON.stringify(data);
  res.write(`data: ${json}\n\n`);
}

/**
 * Creates an Express Router with two SSE transport routes:
 *   GET  /mcp/sse        — opens a persistent SSE stream for a client session
 *   POST /mcp/message    — receives a JSON-RPC request and pushes the response via SSE
 *
 * Usage in server.ts:
 *   import { createMcpSseRouter } from './infrastructure/mcp/mcp-server.js';
 *   app.use('/mcp', createMcpSseRouter());
 */
export function createMcpSseRouter(): Router {
  const router = Router();

  // ─── GET /mcp/sse ─────────────────────────────────────────────────────────
  // Opens a persistent SSE connection. The client receives a session ID in the
  // 'endpoint' event, which it must include in subsequent POST requests.
  router.get('/sse', (req: Request, res: Response) => {
    const sessionId = randomUUID();

    // Standard SSE headers — mirrors the existing stream implementation
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    // Register this client
    sseClients.set(sessionId, res);

    // MCP SSE transport: first event MUST be 'endpoint' with the POST URL
    res.write(`event: endpoint\ndata: /mcp/message?sessionId=${sessionId}\n\n`);

    logger.info('[MCP/SSE] Client connected', { sessionId });

    // Clean up on disconnect
    req.on('close', () => {
      sseClients.delete(sessionId);
      logger.info('[MCP/SSE] Client disconnected', { sessionId });
    });
  });

  // ─── POST /mcp/message ────────────────────────────────────────────────────
  // Receives a JSON-RPC request and responds via the SSE stream.
  // Requires `sessionId` query param matching an active /mcp/sse connection.
  router.post('/message', async (req: Request, res: Response) => {
    const sessionId = (req.query['sessionId'] as string) ?? '';
    const sseRes = sseClients.get(sessionId);

    if (!sseRes) {
      res.status(400).json({
        error: `No active SSE session for sessionId: ${sessionId}`,
      });
      return;
    }

    const body = req.body as JsonRpcRequest | undefined;

    if (!body || typeof body !== 'object' || body.jsonrpc !== '2.0') {
      res.status(400).json({ error: 'Invalid JSON-RPC 2.0 request body' });
      return;
    }

    // Seed AsyncLocalStorage for tracing (Patrón 5)
    const traceId = randomUUID();
    await requestContext.run(createRootContext(traceId), async () => {
      try {
        const response = await handleMcpRequest(body);

        if (response !== null) {
          // Push the response back via the persistent SSE channel
          sendSseEvent(sseRes, response);
        }

        // Acknowledge the POST immediately (body was received and queued)
        res.status(202).json({ accepted: true });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        res.status(500).json({
          jsonrpc: '2.0',
          id: body.id ?? null,
          error: { code: JSON_RPC_ERRORS.INTERNAL_ERROR, message },
        });
      }
    });
  });

  return router;
}

// ─────────────────────────────────────────────────────────────────────────────
// STANDALONE STDIO MODE
// Allow running: node --experimental-strip-types mcp-server.ts --stdio
// ─────────────────────────────────────────────────────────────────────────────

if (process.argv.includes('--stdio')) {
  startMcpStdioServer();
}
