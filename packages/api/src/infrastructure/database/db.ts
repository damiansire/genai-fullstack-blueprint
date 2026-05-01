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
  private insertCacheStmt: any = null;
  private selectCacheStmt: any = null;

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
          );
          CREATE TABLE IF NOT EXISTS semantic_cache (
            hash TEXT PRIMARY KEY,
            response TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
      `);

      // Try to load sqlite-vec extension (graceful degradation if not compiled)
      try {
        // En Node v22.5.0+ db.loadExtension existe. 
        if (typeof (this.db as any).loadExtension === 'function') {
          // Asumimos que el binario de sqlite-vec está en el entorno
          (this.db as any).loadExtension('vec0');
          logger.info('[DB] sqlite-vec extension loaded natively.');
          
          this.proxiedDb.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS semantic_vectors USING vec0(
              id INTEGER PRIMARY KEY,
              embedding float[1536]
            );
          `);
        }
      } catch (err) {
        logger.warn('[DB] Could not load sqlite-vec extension. Vector search will be disabled.', {}, err instanceof Error ? err : new Error(String(err)));
      }

      this.insertLogStmt = this.proxiedDb.prepare('INSERT INTO request_logs (trace_id, timestamp, method, path, duration_ms) VALUES (?, ?, ?, ?, ?)');
      this.selectLogsStmt = this.proxiedDb.prepare('SELECT * FROM request_logs ORDER BY id DESC LIMIT ?');
      this.insertCacheStmt = this.proxiedDb.prepare('INSERT OR REPLACE INTO semantic_cache (hash, response, created_at) VALUES (?, ?, ?)');
      this.selectCacheStmt = this.proxiedDb.prepare('SELECT response FROM semantic_cache WHERE hash = ?');
      
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
      this.insertCacheStmt = null;
      this.selectCacheStmt = null;
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

  public getCachedResponse(hash: string): any | null {
    if (!this.selectCacheStmt) return null;
    try {
      const row = this.selectCacheStmt.get(hash);
      return row ? JSON.parse(row.response) : null;
    } catch (error) {
      logger.error('Failed to get cache', {}, error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  public setCachedResponse(hash: string, response: any): void {
    if (!this.insertCacheStmt) return;
    try {
      this.insertCacheStmt.run(hash, JSON.stringify(response), new Date().toISOString());
    } catch (error) {
      logger.error('Failed to set cache', {}, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Native Semantic Similarity Search using sqlite-vec
   */
  public searchSimilarVectors(embedding: Float32Array, limit: number = 5): any[] {
    try {
      const stmt = this.proxiedDb.prepare(`
        SELECT id, distance 
        FROM semantic_vectors 
        WHERE embedding MATCH ? 
        ORDER BY distance 
        LIMIT ?
      `);
      return stmt.all(embedding, limit);
    } catch (error) {
      logger.error('Vector search failed', {}, error instanceof Error ? error : new Error(String(error)));
      return [];
    }
  }

  public storeVector(id: number, embedding: Float32Array): void {
    try {
      const stmt = this.proxiedDb.prepare('INSERT INTO semantic_vectors (id, embedding) VALUES (?, ?)');
      stmt.run(id, embedding);
    } catch (error) {
      logger.error('Store vector failed', {}, error instanceof Error ? error : new Error(String(error)));
    }
  }
}

export const dbService = DatabaseService.getInstance();
export const logRequest = dbService.logRequest.bind(dbService);
export const getRecentLogs = dbService.getRecentLogs.bind(dbService);
export const getCachedResponse = dbService.getCachedResponse.bind(dbService);
export const setCachedResponse = dbService.setCachedResponse.bind(dbService);
