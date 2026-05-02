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
  // Patrón 1: Tool Search JIT
  private insertToolStmt: any = null;
  private searchToolsStmt: any = null;
  private getToolByNameStmt: any = null;
  // Patrón 3: sqlite-vec int8 quantized vectors
  private insertVectorStmt: any = null;
  private searchVectorStmt: any = null;
  private insertVectorMetaStmt: any = null;
  private getVectorMetaStmt: any = null;
  private vecExtensionLoaded = false;

  // Rate Limiting (Token Store)
  private updateRateLimitStmt: any = null;
  private getRateLimitStmt: any = null;

  // Gemini Context Cache
  private insertContextCacheStmt: any = null;
  private selectContextCacheStmt: any = null;

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
          CREATE TABLE IF NOT EXISTS tools (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            description TEXT NOT NULL,
            schema_json TEXT NOT NULL,
            category TEXT DEFAULT 'general',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_tools_name ON tools(name);
          CREATE INDEX IF NOT EXISTS idx_tools_category ON tools(category);
          
          CREATE TABLE IF NOT EXISTS rate_limit_tokens (
            identifier TEXT PRIMARY KEY,
            tokens INTEGER NOT NULL,
            last_refill TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS gemini_context_cache (
            id TEXT PRIMARY KEY,
            file_name TEXT NOT NULL,
            mime_type TEXT,
            size_bytes INTEGER,
            created_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS prompts (
            name TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            description TEXT,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            tenant_id TEXT,
            title TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
          );
      `);

      // Patrón 3: sqlite-vec — int8 quantized vector search
      // Design: two tables work together:
      //   semantic_vectors (vec0 virtual)  — stores int8[768] quantized embeddings for KNN
      //   semantic_cache_meta              — maps vector_id → prompt_hash + cached response
      // Using 768 dims (Xenova/gte-base output) quantized to int8:
      //   float32[768] = 3072 bytes per vector
      //   int8[768]    =  768 bytes per vector  (~4x compression)
      // At scale: 1M vectors ≈ 750 MB int8 vs ~3 GB float32
      try {
        if (typeof (this.db as any).loadExtension === 'function') {
          (this.db as any).loadExtension('vec0');
          this.vecExtensionLoaded = true;
          logger.info('[DB] sqlite-vec extension loaded — int8 vector search enabled.');

          this.proxiedDb.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS semantic_vectors USING vec0(
              embedding int8[768]
            );
            CREATE TABLE IF NOT EXISTS semantic_cache_meta (
              vector_id   INTEGER PRIMARY KEY,
              prompt_hash TEXT NOT NULL UNIQUE,
              response    TEXT NOT NULL,
              model_id    TEXT NOT NULL,
              created_at  TEXT NOT NULL,
              hit_count   INTEGER DEFAULT 0
            );
          `);
        }
      } catch (err) {
        logger.warn('[DB] Could not load sqlite-vec extension. Semantic vector search disabled.', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      this.insertLogStmt = this.proxiedDb.prepare('INSERT INTO request_logs (trace_id, timestamp, method, path, duration_ms) VALUES (?, ?, ?, ?, ?)');
      this.selectLogsStmt = this.proxiedDb.prepare('SELECT * FROM request_logs ORDER BY id DESC LIMIT ?');
      this.insertCacheStmt = this.proxiedDb.prepare('INSERT OR REPLACE INTO semantic_cache (hash, response, created_at) VALUES (?, ?, ?)');
      this.selectCacheStmt = this.proxiedDb.prepare('SELECT response FROM semantic_cache WHERE hash = ?');

      // Patrón 1: Tool Search JIT — prepared statements
      this.insertToolStmt = this.proxiedDb.prepare(
        'INSERT OR REPLACE INTO tools (name, description, schema_json, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      );
      // Simple keyword search across name + description — no external FTS engine needed
      this.searchToolsStmt = this.proxiedDb.prepare(
        `SELECT name, description, schema_json, category FROM tools
         WHERE name LIKE ? OR description LIKE ? OR category LIKE ?
         ORDER BY name ASC LIMIT ?`
      );
      this.getToolByNameStmt = this.proxiedDb.prepare(
        'SELECT name, description, schema_json, category FROM tools WHERE name = ?'
      );

      // Rate Limiting Tokens
      this.updateRateLimitStmt = this.proxiedDb.prepare(
        'INSERT OR REPLACE INTO rate_limit_tokens (identifier, tokens, last_refill) VALUES (?, ?, ?)'
      );
      this.getRateLimitStmt = this.proxiedDb.prepare(
        'SELECT tokens, last_refill FROM rate_limit_tokens WHERE identifier = ?'
      );

      // Gemini Context Cache
      this.insertContextCacheStmt = this.proxiedDb.prepare(
        'INSERT OR REPLACE INTO gemini_context_cache (id, file_name, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?)'
      );
      this.selectContextCacheStmt = this.proxiedDb.prepare(
        'SELECT id, file_name, mime_type, size_bytes, created_at FROM gemini_context_cache WHERE id = ?'
      );

      // Prompt Playground
      this.proxiedDb.prepare(
        'INSERT OR IGNORE INTO prompts (name, content, description, updated_at) VALUES (?, ?, ?, ?)'
      ).run('generate_code', 'You are an expert coder. Generate code...', 'Default code gen prompt', new Date().toISOString());


      // Patrón 3: vector prepared statements (only when extension loaded)
      if (this.vecExtensionLoaded) {
        this.insertVectorStmt = this.proxiedDb.prepare(
          'INSERT INTO semantic_vectors(rowid, embedding) VALUES (?, ?)'
        );
        // KNN search: returns the rowid of the nearest neighbor within distance threshold
        this.searchVectorStmt = this.proxiedDb.prepare(
          `SELECT rowid, distance
           FROM semantic_vectors
           WHERE embedding MATCH ?
             AND k = ?
           ORDER BY distance`
        );
        this.insertVectorMetaStmt = this.proxiedDb.prepare(
          `INSERT OR REPLACE INTO semantic_cache_meta
           (vector_id, prompt_hash, response, model_id, created_at)
           VALUES (?, ?, ?, ?, ?)`
        );
        this.getVectorMetaStmt = this.proxiedDb.prepare(
          `UPDATE semantic_cache_meta SET hit_count = hit_count + 1
           WHERE vector_id = ?
           RETURNING prompt_hash, response, model_id, hit_count`
        );
      }
      
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
      this.insertToolStmt = null;
      this.searchToolsStmt = null;
      this.getToolByNameStmt = null;
      // Patrón 3
      this.insertVectorStmt = null;
      this.searchVectorStmt = null;
      this.insertVectorMetaStmt = null;
      this.getVectorMetaStmt = null;
      this.vecExtensionLoaded = false;
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Patrón 3: sqlite-vec int8 Quantized Vector Cache
  // ─────────────────────────────────────────────────────────────────────────────

  /** True when the sqlite-vec extension is loaded and vector ops are available. */
  public isVecEnabled(): boolean {
    return this.vecExtensionLoaded;
  }

  /**
   * Quantizes a Float32Array to Int8Array for storage in sqlite-vec int8 columns.
   *
   * Method: linear quantization per-vector.
   *   q_i = clamp(round(v_i / absMax * 127), -127, 127)
   * This preserves the cosine similarity ranking while compressing
   * float32[768] (3072 bytes) → int8[768] (768 bytes) — ~4x compression.
   * Cosine similarity error is typically < 2% vs full float32.
   *
   * Reference: https://arxiv.org/abs/2309.07305 (scalar quantization)
   */
  public static quantizeToInt8(vec: Float32Array): Int8Array {
    const absMax = Math.max(...Array.from(vec).map(Math.abs)) || 1;
    const scale = 127 / absMax;
    const result = new Int8Array(vec.length);
    for (let i = 0; i < vec.length; i++) {
      result[i] = Math.max(-127, Math.min(127, Math.round(vec[i]! * scale)));
    }
    return result;
  }

  /**
   * Stores an int8-quantized embedding in sqlite-vec and links it to the
   * semantic cache metadata table.
   *
   * @param vectorId   Monotonically increasing integer ID (rowid in vec0)
   * @param embedding  Raw Float32Array from the embedding model
   * @param promptHash SHA-256 hash of the full prompt payload
   * @param response   Serialized LLM response to cache
   * @param modelId    Model that produced the response
   */
  public storeSemanticVector(
    vectorId: number,
    embedding: Float32Array,
    promptHash: string,
    response: object,
    modelId: string
  ): void {
    if (!this.vecExtensionLoaded || !this.insertVectorStmt || !this.insertVectorMetaStmt) return;
    try {
      const int8Vec = DatabaseService.quantizeToInt8(embedding);
      this.insertVectorStmt.run(vectorId, int8Vec);
      this.insertVectorMetaStmt.run(
        vectorId,
        promptHash,
        JSON.stringify(response),
        modelId,
        new Date().toISOString()
      );
    } catch (error) {
      logger.error('[Vec] storeSemanticVector failed', { vectorId, modelId },
        error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Searches for the nearest cached response using approximate KNN.
   * Returns the cached response if the nearest neighbor's distance is below
   * the similarity threshold (default: 0.15 in L2 space ≈ 0.93 cosine).
   *
   * The caller must quantize the query vector first OR pass the raw Float32Array
   * — this method handles quantization internally for API simplicity.
   *
   * @param queryEmbedding Raw Float32Array from the embedding model
   * @param topK           Candidates to retrieve from sqlite-vec (default: 3)
   * @param distThreshold  L2 distance threshold (lower = stricter match)
   */
  public findSemanticMatch(
    queryEmbedding: Float32Array,
    topK: number = 3,
    distThreshold: number = 0.15
  ): { response: any; modelId: string; hitCount: number } | null {
    if (!this.vecExtensionLoaded || !this.searchVectorStmt || !this.getVectorMetaStmt) return null;
    try {
      const int8Query = DatabaseService.quantizeToInt8(queryEmbedding);
      const candidates = this.searchVectorStmt.all(int8Query, topK) as Array<{
        rowid: number;
        distance: number;
      }>;

      if (candidates.length === 0) return null;

      const best = candidates[0]!;
      if (best.distance > distThreshold) {
        logger.info('[Vec] Semantic search: nearest neighbor too distant', {
          distance: best.distance,
          threshold: distThreshold,
        });
        return null;
      }

      // Increment hit_count and return cached data atomically
      const meta = this.getVectorMetaStmt.get(best.rowid) as {
        prompt_hash: string;
        response: string;
        model_id: string;
        hit_count: number;
      } | undefined;

      if (!meta) return null;

      logger.info('[Vec] Semantic cache HIT', {
        distance: best.distance,
        hitCount: meta.hit_count,
        modelId: meta.model_id,
      });

      return {
        response: JSON.parse(meta.response),
        modelId: meta.model_id,
        hitCount: meta.hit_count,
      };
    } catch (error) {
      logger.error('[Vec] findSemanticMatch failed', {},
        error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  // ─── Legacy stubs (kept for backwards compat, superseded by storeSemanticVector) ─
  /** @deprecated Use storeSemanticVector() instead. */
  public storeVector(id: number, embedding: Float32Array): void {
    this.storeSemanticVector(id, embedding, `legacy-${id}`, {}, 'unknown');
  }
  /** @deprecated Use findSemanticMatch() instead. */
  public searchSimilarVectors(embedding: Float32Array, limit: number = 5): any[] {
    const match = this.findSemanticMatch(embedding, limit);
    return match ? [match] : [];
  }
  // ─────────────────────────────────────────────────────────────────────────────
  // Patrón 1: Tool Search JIT — Tool Registry Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Registers (or updates) a tool definition in SQLite.
   * The schema_json is the complete JSON Schema the LLM will receive JIT.
   */
  public registerTool(
    name: string,
    description: string,
    schemaJson: object,
    category: string = 'general'
  ): void {
    if (!this.insertToolStmt) return;
    try {
      const now = new Date().toISOString();
      this.insertToolStmt.run(name, description, JSON.stringify(schemaJson), category, now, now);
      logger.info(`[ToolRegistry] Registered tool: ${name}`, { category });
    } catch (error) {
      logger.error('Failed to register tool', { name }, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * JIT Tool Search — called by the LLM via the `search_tools` native tool.
   * Returns the exact JSON schemas to inject at the END of the context window,
   * preserving the cache prefix for Anthropic / OpenAI prompt caching.
   */
  public searchTools(
    query: string,
    limit: number = 5
  ): Array<{ name: string; description: string; schema: object; category: string }> {
    if (!this.searchToolsStmt) return [];
    try {
      const pattern = `%${query}%`;
      const rows = this.searchToolsStmt.all(pattern, pattern, pattern, limit) as any[];
      return rows.map((row) => ({
        name: row.name,
        description: row.description,
        schema: JSON.parse(row.schema_json),
        category: row.category,
      }));
    } catch (error) {
      logger.error('Failed to search tools', { query }, error instanceof Error ? error : new Error(String(error)));
      return [];
    }
  }

  /**
   * Retrieves a single tool's full schema by its exact name.
   */
  public getToolByName(
    name: string
  ): { name: string; description: string; schema: object; category: string } | null {
    if (!this.getToolByNameStmt) return null;
    try {
      const row = this.getToolByNameStmt.get(name) as any;
      if (!row) return null;
      return {
        name: row.name,
        description: row.description,
        schema: JSON.parse(row.schema_json),
        category: row.category,
      };
    } catch (error) {
      logger.error('Failed to get tool by name', { name }, error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Rate Limiting Tokens
  // ─────────────────────────────────────────────────────────────────────────────
  public updateRateLimitToken(identifier: string, tokens: number, lastRefill: string): void {
    if (!this.updateRateLimitStmt) return;
    try {
      this.updateRateLimitStmt.run(identifier, tokens, lastRefill);
    } catch (error) {
      logger.error('Failed to update rate limit token', { identifier }, error instanceof Error ? error : new Error(String(error)));
    }
  }

  public getRateLimitToken(identifier: string): { tokens: number; lastRefill: string } | null {
    if (!this.getRateLimitStmt) return null;
    try {
      const row = this.getRateLimitStmt.get(identifier) as any;
      if (!row) return null;
      return { tokens: row.tokens, lastRefill: row.last_refill };
    } catch (error) {
      logger.error('Failed to get rate limit token', { identifier }, error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Gemini Context Cache
  // ─────────────────────────────────────────────────────────────────────────────
  public saveContextCache(id: string, fileName: string, mimeType: string, sizeBytes: number): void {
    if (!this.insertContextCacheStmt) return;
    try {
      const now = new Date().toISOString();
      this.insertContextCacheStmt.run(id, fileName, mimeType, sizeBytes, now);
      logger.info(`[ContextCache] Saved cache ID: ${id}`);
    } catch (error) {
      logger.error('Failed to save context cache', { id }, error instanceof Error ? error : new Error(String(error)));
    }
  }

  public getContextCache(id: string): { id: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: string } | null {
    if (!this.selectContextCacheStmt) return null;
    try {
      const row = this.selectContextCacheStmt.get(id) as any;
      if (!row) return null;
      return {
        id: row.id,
        fileName: row.file_name,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        createdAt: row.created_at,
      };
    } catch (error) {
      logger.error('Failed to get context cache', { id }, error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }
}

export const dbService = DatabaseService.getInstance();
export const logRequest = dbService.logRequest.bind(dbService);
export const getRecentLogs = dbService.getRecentLogs.bind(dbService);
export const getCachedResponse = dbService.getCachedResponse.bind(dbService);
export const setCachedResponse = dbService.setCachedResponse.bind(dbService);
// Patrón 1 exports
export const registerTool = dbService.registerTool.bind(dbService);
export const searchTools = dbService.searchTools.bind(dbService);
export const getToolByName = dbService.getToolByName.bind(dbService);
// Patrón 3 exports
export const isVecEnabled = dbService.isVecEnabled.bind(dbService);
export const storeSemanticVector = dbService.storeSemanticVector.bind(dbService);
export const findSemanticMatch = dbService.findSemanticMatch.bind(dbService);
export const { quantizeToInt8 } = DatabaseService;

// Rate Limit and Context Cache exports
export const updateRateLimitToken = dbService.updateRateLimitToken.bind(dbService);
export const getRateLimitToken = dbService.getRateLimitToken.bind(dbService);
export const saveContextCache = dbService.saveContextCache.bind(dbService);
export const getContextCache = dbService.getContextCache.bind(dbService);
