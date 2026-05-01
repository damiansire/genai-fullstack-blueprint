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
import { dbService, logRequest } from './infrastructure/database/db.js';
// Stability: 2 - Stable (node:perf_hooks)
import { performance } from 'node:perf_hooks';
// Stability: 2 - Stable (node:crypto)
import { randomUUID, createHash } from 'node:crypto';
import { requestContext } from './core/async-context.js';
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
      
      requestContext.run({ traceId }, () => {
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

    // Apply Rate Limiter globally for /api routes
    const apiLimiter = rateLimiter({
      windowMs: 60 * 1000, // 1 minute
      max: 100 // limit each IP/API Key to 100 requests per windowMs
    });

    // Model routes (authentication, validation, controllers)
    const modelRoutes = createModelRoutes(modelFactory, schemaRegistry);
    this.app.use('/api', apiLimiter, modelRoutes);

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
}

// Create and start the server
const server = new Server();

// Graceful Shutdown Handler Pattern
const handleGracefulShutdown = async (signal: string) => {
  logger.info(`${signal} received. Initiating graceful shutdown sequence...`);
  await server.stop();
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
