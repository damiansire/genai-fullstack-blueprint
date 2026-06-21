import express from 'express';
import cors from 'cors';
// Stability: 2 - Stable (node:util)
import { parseArgs } from 'node:util';
// Stability: 2 - Stable (node:events)
import { EventEmitter } from 'node:events';
import { modelFactory } from './infrastructure/ai/factory.js';
import { schemaRegistry } from './infrastructure/ai/registry.js';
import { loadPlugins } from './infrastructure/ai/loader.js';
import { createModelRoutes } from './api/routes/modelRoutes.js';
import { docsRoutes } from './api/routes/docsRoutes.js';
import { errorHandler } from './api/middleware/errorHandler.js';
import { rateLimiter } from './api/middleware/rateLimiter.js';
import { tokenRateLimiter } from './api/middleware/tokenRateLimiter.js';
import { aiSafetyFirewall } from './api/middleware/ai-safety.middleware.js';
import { SqliteTokenStore } from './infrastructure/rate-limit/SqliteTokenStore.js';
import { SqliteRateLimitStore } from './infrastructure/rate-limit/SqliteRateLimitStore.js';
import { dbService, logRequest } from './infrastructure/database/db.js';
// Stability: 2 - Stable (node:perf_hooks)
import { performance } from 'node:perf_hooks';
// Stability: 2 - Stable (node:crypto)
import { randomUUID, createHash } from 'node:crypto';
import { requestContext, createRootContext, finishSpan } from './core/async-context.js';
import { otlpTraceExporter } from './core/otlp-exporter.js';
import { shutdownWorkerPools } from './infrastructure/workers/workerPool.js';
import { createToolRoutes } from './api/routes/toolRoutes.js';
import { createMcpSseRouter } from './infrastructure/mcp/mcp-server.js';
import { createDomainRoutes } from './api/routes/domainRoutes.js';
import { createPromptRoutes } from './api/routes/promptRoutes.js';
import { createUserRoutes } from './api/routes/userRoutes.js';
import { createSessionRoutes } from './api/routes/sessionRoutes.js';
import { registerTool } from './infrastructure/database/db.js';
// Stability: 2 - Stable (node:http)
import type { Server as HttpServer } from 'node:http';
import { logger } from './core/logger.js';
import { config } from './core/config.js';

type ServerState = 'STOPPED' | 'STARTING' | 'RUNNING' | 'STOPPING';

/**
 * Main Express server configuration
 * Implements State Pattern, Observer Pattern (EventEmitter), and Graceful Shutdown
 */
class Server extends EventEmitter {
  private app: express.Application;
  private port: number;
  private state: ServerState = 'STOPPED';
  private httpServer: HttpServer | null = null;
  private tokenStore = new SqliteTokenStore();
  private requestLimitStore = new SqliteRateLimitStore();

  constructor() {
    super();
    this.app = express();

    // Use native util.parseArgs for command-line arguments
    const { values } = parseArgs({
      options: {
        port: {
          type: 'string',
          short: 'p',
        },
      },
      strict: false,
    });

    const portArg = typeof values.port === 'string' ? values.port : undefined;
    this.port = parseInt(portArg || process.env['PORT'] || config.server.port.toString(), 10);
    
    this.setupMiddleware();
    this.setupRoutes();

    // Observe Database events (Observer Pattern)
    dbService.on('query', (data) => {
      // Basic query observation hook
      if (process.env['NODE_ENV'] === 'development') {
        logger.info(`[DB] executed ${data.method}`);
      }
    });
  }

  /**
   * Configure Express middleware
   */
  private setupMiddleware(): void {
    // CORS configuration
    this.app.use(cors({
      origin: config.server.allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Key']
    }));

    // Body parsing middleware
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging middleware using native SQLite and trace ID
    this.app.use((req, res, next) => {
      const traceId = randomUUID();
      const start = performance.now();
      
      // Set trace ID in response headers
      res.setHeader('X-Trace-Id', traceId);
      
      res.on('finish', () => {
        const duration = Math.round(performance.now() - start);
        logger.info(`${req.method} ${req.path}`, { duration, method: req.method, path: req.path, traceId });
        logRequest(req.method, req.path, duration, traceId);
      });
      
      // Patrón 5: seed a full agentic root span (depth=0) for this request.
      // All downstream Workers inherit this via createChildContext().
      const rootCtx = createRootContext(traceId);

      res.on('finish', () => {
        // Close the root HTTP span and export it via OTLP (no-op if the exporter
        // is disabled). 2xx/3xx → OK, otherwise ERROR.
        finishSpan(rootCtx, `${req.method} ${req.path}`, res.statusCode < 400 ? 1 : 2, {
          'http.method': req.method,
          'http.route': req.path,
          'http.status_code': res.statusCode,
        });
      });

      requestContext.run(rootCtx, () => {
        next();
      });
    });
  }

  /**
   * Setup application routes
   */
  private setupRoutes(): void {
    // Health check endpoints (Liveness & Readiness probes)
    this.app.get('/health/live', (_req, res) => {
      res.status(200).json({ status: 'live', state: this.state });
    });

    this.app.get('/health/ready', (_req, res) => {
      // If server is not fully running, or DB is not initialized, we are not ready
      if (this.state !== 'RUNNING') {
        res.status(503).json({ status: 'not_ready', state: this.state });
        return;
      }
      
      // In a real app we might do `dbService.ping()` here
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: config.env,
        registeredModels: modelFactory.getRegisteredModels()
      });
    });

    // API info endpoint
    this.app.get('/api/info', (_req, res) => {
      res.json({
        name: 'AI Gateway API',
        version: '1.0.0',
        description: 'Multimodal AI Gateway with plugin architecture',
        availableModels: modelFactory.getRegisteredModels(),
        totalModels: modelFactory.getRegisteredModels().length
      });
    });

    // Serve OpenAPI Documentation
    this.app.use('/docs', docsRoutes);

    // Request-count limiter. Persistent backend (SQLite) so the count survives
    // restarts and is shared across the node; swap to InMemoryRateLimitStore for
    // a pure single-process setup. Keyed by API-key identity once auth has run.
    const apiLimiter = rateLimiter({
      windowMs: 60 * 1000, // 1 minute
      max: 100, // limit each API Key (or IP, pre-auth) to 100 requests per window
      store: this.requestLimitStore,
    });

    // Apply Token Rate Limiter to /api routes (e.g. 50000 tokens per minute limit)
    const apiTokenLimiter = tokenRateLimiter(this.tokenStore, {
      windowMs: 60 * 1000,
      maxTokens: 50000
    });

    // Middleware ORDER (P2 fix): authentication is the real front gate. Inside
    // these routers the chain is `apiKeyAuth → apiLimiter → apiTokenLimiter →
    // aiSafetyFirewall → handler`, so:
    //   - the limiters key by `req.user.apiKeyId` (real per-tenant buckets, not a
    //     single shared IP bucket behind a proxy/NAT), and
    //   - the (potentially heavy) safety/PII work never runs for unauthenticated
    //     callers — auth rejects them first.
    // The cross-cutting chain is wired INSIDE each router (router.use) so it stays
    // scoped to those paths and doesn't leak onto sibling /api mounts below.
    const modelRoutes = createModelRoutes(modelFactory, schemaRegistry, [
      apiLimiter,
      apiTokenLimiter,
      aiSafetyFirewall,
    ]);
    this.app.use('/api', modelRoutes);

    // Patrón 1: Tool Search JIT — register, search, and manage tool definitions.
    // Auth first, then the per-key limiter (scoped inside the router).
    const toolRoutes = createToolRoutes([apiLimiter]);
    this.app.use('/api/tools', toolRoutes);

    // Patrón 2: MCP Server — SSE transport for web-based MCP clients
    // stdio transport is a separate process: npm run mcp:stdio
    const mcpRouter = createMcpSseRouter();
    this.app.use('/mcp', mcpRouter);

    // Patrones 7, 9, 10: Domain use cases (Security, IoT Telemetry, Code Generation)
    const domainRouter = createDomainRoutes();
    this.app.use('/api/domain', domainRouter);

    // Enterprise Modules. Each router gates auth FIRST (router.use(apiKeyAuth))
    // and then runs the per-key request limiter, so the limiter buckets by the
    // authenticated req.user.apiKeyId rather than a shared pre-auth IP bucket.
    // Admin prompt routes additionally require the `admin` permission.
    this.app.use('/api/admin/prompts', createPromptRoutes([apiLimiter]));
    this.app.use('/api/user', createUserRoutes([apiLimiter]));
    this.app.use('/api/sessions', createSessionRoutes([apiLimiter]));

    // Seed Tool Registry with domain tools (Patrón 1 integration)
    this.seedToolRegistry();

    // 404 handler for undefined routes
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString()
      });
    });

    // Global error handler
    this.app.use(errorHandler);
  }

  private changeState(newState: ServerState) {
    this.state = newState;
    this.emit('stateChange', this.state);
  }

  /**
   * Initialize the server and load plugins
   */
  public async initialize(): Promise<void> {
    if (this.state !== 'STOPPED') return;
    this.changeState('STARTING');

    try {
      logger.info('Initializing AI Gateway Server...');
      
      dbService.initialize();

      // Load all plugins
      logger.info('Loading plugins...');
      await loadPlugins(modelFactory, schemaRegistry);
      
      logger.info('Server initialization completed successfully');
    } catch (error) {
      logger.error('Failed to initialize server', {}, error);
      this.changeState('STOPPED');
      throw error;
    }
  }

  public async start(): Promise<void> {
    try {
      if (this.state === 'STOPPED') {
        await this.initialize();
      }
      
      const { createServer } = await import('node:http');
      
      // Node.js Security Best Practices: Mitigate CWE-444 (HTTP Request Smuggling)
      this.httpServer = createServer({ insecureHTTPParser: false }, this.app);
      
      // Node.js Security Best Practices: Mitigate CWE-400 (Denial of Service)
      this.httpServer.headersTimeout = 60000; // 60 seconds
      this.httpServer.requestTimeout = 300000; // 5 minutes
      this.httpServer.timeout = 300000; // 5 minutes
      this.httpServer.keepAliveTimeout = 5000; // 5 seconds
      
      this.httpServer.listen(this.port, () => {
        this.changeState('RUNNING');
        logger.info(`AI Gateway Server running on port ${this.port}`, {
          port: this.port,
          registeredModels: modelFactory.getRegisteredModels()
        });
      });

      // Native WebSocket Implementation (No 'ws' or 'socket.io' libraries)
      this.httpServer.on('upgrade', (req, socket, _head) => {
        if (req.url !== '/api/ws') {
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
          socket.destroy();
          return;
        }

        const key = req.headers['sec-websocket-key'];
        if (!key) {
          socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
          socket.destroy();
          return;
        }

        // Standard WebSocket Handshake per RFC 6455
        const magicString = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
        const acceptKey = createHash('sha1').update(key + magicString).digest('base64');

        const responseHeaders = [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${acceptKey}`,
          '\r\n'
        ].join('\r\n');

        socket.write(responseHeaders);
        logger.info('Native WebSocket connection established on /api/ws');

        socket.on('data', (_buffer) => {
          // In a real implementation we would parse WebSocket frames here.
          // For now, we echo back a simple text frame showing we received data.
          // Native frame construction for a text message:
          const message = 'Acknowledged native frame';
          const msgBuffer = Buffer.from(message);
          const frame = Buffer.alloc(2 + msgBuffer.length);
          frame[0] = 0x81; // FIN + Text Frame
          frame[1] = msgBuffer.length;
          msgBuffer.copy(frame, 2);
          socket.write(frame);
        });

        socket.on('error', (err) => logger.error('WebSocket Error', {}, err));
        socket.on('close', () => logger.info('WebSocket connection closed'));
      });
    } catch (error) {
      logger.error('Failed to start server', {}, error);
      process.exit(1);
    }
  }

  public async stop(): Promise<void> {
    if (this.state !== 'RUNNING' && this.state !== 'STARTING') return;
    this.changeState('STOPPING');
    logger.info('Shutting down Server Gracefully...');

    return new Promise((resolve) => {
      const finishShutdown = () => {
        dbService.close();
        this.changeState('STOPPED');
        logger.info('Server shutdown complete.');
        resolve();
      };

      if (this.httpServer) {
        this.httpServer.close((err) => {
          if (err) logger.error('Error closing HTTP server', {}, err);
          finishShutdown();
        });
      } else {
        finishShutdown();
      }
    });
  }

  /**
   * Get the Express application instance
   */
  public getApp(): express.Application {
    return this.app;
  }

  /**
   * Seeds the SQLite Tool Registry with domain tools at startup.
   * Patrón 1 + Patrón 6 integration: tools appear in Tool Explorer automatically.
   * Uses INSERT OR REPLACE — safe to call on every boot.
   */
  private seedToolRegistry(): void {
    try {
      registerTool('analyze_security_logs', 'Analyzes raw log text for security threats using MITRE ATT&CK patterns. Returns a structured report with severity, indicators, and mitigations.', {
        type: 'object',
        properties: {
          logs: { type: 'string', description: 'Raw log text (newline-separated entries)', format: 'textarea' },
        },
        required: ['logs'],
      }, 'security');

      registerTool('stream_telemetry', 'Opens a real-time SSE stream of IoT sensor readings. Returns device frames with Z-score anomaly detection.', {
        type: 'object',
        properties: {
          devices: { type: 'string', description: 'Comma-separated device IDs to monitor (empty = all)', examples: ['TEMP-WH-001,HUM-WH-001'] },
        },
      }, 'iot');

      registerTool('generate_code', 'Generates code from a spec string with iterative quality analysis and refinement. Returns code + metrics + suggestions.', {
        type: 'object',
        properties: {
          spec: { type: 'string', description: 'Natural language specification of the code to generate', format: 'textarea' },
          language: { type: 'string', enum: ['typescript', 'javascript', 'python', 'go', 'rust', 'sql'], description: 'Target programming language', default: 'typescript' },
        },
        required: ['spec'],
      }, 'devtools');

      registerTool('search_tools', 'Searches the tool registry for relevant tool schemas. Use this before calling any domain tool to retrieve its exact JSON schema JIT.', {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keyword to search for in tool names and descriptions' },
          limit: { type: 'number', description: 'Maximum number of results (default: 5, max: 20)', minimum: 1, maximum: 20 },
        },
        required: ['query'],
      }, 'meta');

      logger.info('[Server] Tool Registry seeded with domain tools.');
    } catch (err) {
      // Non-critical: Tool Registry may already have these tools from previous boot
      logger.warn('[Server] Tool Registry seed skipped (tools may already exist)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}


// Create and start the server
const server = new Server();

// Graceful Shutdown Handler Pattern
const handleGracefulShutdown = async (signal: string) => {
  logger.info(`${signal} received. Initiating graceful shutdown sequence...`);
  await server.stop();
  // Terminate any worker threads so the process can exit without lingering handles.
  await shutdownWorkerPools();
  // Flush any buffered OTLP spans before exiting (no-op when the exporter is off).
  await otlpTraceExporter.shutdown();
  process.exit(0);
};

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));

// Start the server
server.start().catch((error) => {
  logger.error('Fatal error starting server', {}, error);
  process.exit(1);
});

export default server;
