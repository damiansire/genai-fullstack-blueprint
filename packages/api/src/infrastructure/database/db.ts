// Stability: 1 - Experimental (node:sqlite)
import { DatabaseSync } from 'node:sqlite';
// Stability: 2 - Stable (node:fs)
import * as fs from 'node:fs';
// Stability: 2 - Stable (node:path)
import * as path from 'node:path';
// Stability: 2 - Stable (node:events)
import { EventEmitter } from 'node:events';
import { getTraceId } from '../../core/async-context.js';
import { logger } from '../../core/logger.js';

/**
 * DB Service implementing Singleton, Proxy, and EventEmitter patterns
 * (Node.js Design Patterns)
 */
export class DatabaseService extends EventEmitter {
  private static instance: DatabaseService;
  private db: DatabaseSync | null = null;
  private proxiedDb: any = null;

  private constructor() {
    super();
  }

  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  private insertLogStmt: any = null;
  private selectLogsStmt: any = null;

  public initialize(): void {
    if (this.db) return;

    try {
      const dataDir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const dbPath = path.join(dataDir, 'gateway.db');
      this.db = new DatabaseSync(dbPath);

      // Apply Proxy Pattern to intercept queries (Node.js Design Patterns)
      this.proxiedDb = new Proxy(this.db, {
        get: (target: any, prop: string) => {
          const origMethod = target[prop];
          if (typeof origMethod === 'function') {
            return (...args: any[]) => {
              if (prop === 'prepare' || prop === 'exec') {
                this.emit('query', { method: prop, query: args[0] });
              }
              return origMethod.apply(target, args);
            };
          }
          return target[prop];
        }
      });

      this.proxiedDb.exec(`
          CREATE TABLE IF NOT EXISTS request_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trace_id TEXT,
            timestamp TEXT NOT NULL,
            method TEXT NOT NULL,
            path TEXT NOT NULL,
            duration_ms INTEGER
          )
      `);

      this.insertLogStmt = this.proxiedDb.prepare('INSERT INTO request_logs (trace_id, timestamp, method, path, duration_ms) VALUES (?, ?, ?, ?, ?)');
      this.selectLogsStmt = this.proxiedDb.prepare('SELECT * FROM request_logs ORDER BY id DESC LIMIT ?');
      
      this.emit('connected');
    } catch (err) {
      this.emit('error', err);
      throw err;
    }
  }

  public close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.proxiedDb = null;
      this.insertLogStmt = null;
      this.selectLogsStmt = null;
      this.emit('closed');
    }
  }

  public logRequest(method: string, reqPath: string, durationMs: number = 0, traceId?: string): void {
    if (!this.insertLogStmt) return;
    try {
      const finalTraceId = traceId || getTraceId() || null;
      this.insertLogStmt.run(finalTraceId, new Date().toISOString(), method, reqPath, durationMs);
    } catch (error) {
      logger.error('Failed to log request to SQLite', {}, error instanceof Error ? error : new Error(String(error)));
    }
  }

  public getRecentLogs(limit: number = 100) {
    if (!this.selectLogsStmt) return [];
    try {
      return this.selectLogsStmt.all(limit);
    } catch (error) {
      logger.error('Failed to retrieve logs from SQLite', {}, error instanceof Error ? error : new Error(String(error)));
      return [];
    }
  }
}

export const dbService = DatabaseService.getInstance();
export const logRequest = dbService.logRequest.bind(dbService);
export const getRecentLogs = dbService.getRecentLogs.bind(dbService);
