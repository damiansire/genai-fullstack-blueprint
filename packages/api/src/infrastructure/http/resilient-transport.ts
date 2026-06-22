// Stability: 2 - Stable (global fetch, AbortSignal — Node v22+)
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { logger } from '../../core/logger.js';

/**
 * Minimal structural contract for a runtime validator (satisfied by any zod
 * schema). Kept structural so the transport does not hard-depend on a zod
 * version's exact type surface — callers pass `z.object({...})` and get a
 * validated, narrowed result.
 */
export interface ResponseValidator<T> {
  safeParse(
    input: unknown,
  ): { success: true; data: T } | { success: false; error: { message: string } };
}

/**
 * Shared resilient HTTP transport for every provider plugin.
 *
 * "Built-in over dependencies": uses the platform-native `fetch` + `AbortSignal`
 * instead of axios/got/undici. There is exactly ONE retry/backoff implementation
 * in the codebase — plugins must not hand-roll `fetch` with their own retry logic.
 *
 * Design (cf. Vercel AI SDK `retry-with-exponential-backoff`):
 *  - Retryability is decided HERE (it knows the status codes), then plugins just
 *    `await transport.fetchJson(...)`. A 4xx (except 408/429) is NOT retried —
 *    retrying a bad request only wastes the user's quota.
 *  - Backoff is header-aware: honor `Retry-After` / `retry-after-ms` from the
 *    provider, clamped to a sane window so a hostile/buggy header cannot pin us
 *    for minutes. Falls back to exponential backoff when there is no usable header.
 *  - Aborts are never retried and abort the in-flight sleep too.
 */

export interface ResilientRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  /** Already-serialized body (caller owns JSON.stringify so it can stream/transfer). */
  body?: string;
  /** Caller's abort signal — propagated to fetch and the retry sleep. */
  signal?: AbortSignal;
  /** Per-attempt timeout in ms (separate from the overall retry budget). Default 30s. */
  timeoutMs?: number;
}

export interface TransportConfig {
  /** Max retry attempts AFTER the first try (so 2 → up to 3 total requests). */
  maxRetries?: number;
  /** Base delay for exponential backoff (ms). */
  baseDelayMs?: number;
  /** Upper bound for any single backoff wait (ms). Caps a hostile Retry-After. */
  maxDelayMs?: number;
  /** Default per-attempt timeout (ms). */
  defaultTimeoutMs?: number;
}

const DEFAULTS: Required<TransportConfig> = {
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 60_000,
  defaultTimeoutMs: 30_000,
};

/** Error thrown for a non-OK HTTP response, carrying the retryability decision. */
export class TransportHttpError extends Error {
  readonly status: number;
  readonly bodyText: string;
  readonly isRetryable: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(status: number, bodyText: string, isRetryable: boolean, retryAfterMs?: number) {
    super(`HTTP ${status}: ${bodyText.slice(0, 500)}`);
    this.name = 'TransportHttpError';
    this.status = status;
    this.bodyText = bodyText;
    this.isRetryable = isRetryable;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

/**
 * Decide whether an HTTP status warrants a retry.
 *  - 408 (timeout) and 429 (rate limit) ARE retryable.
 *  - Any other 4xx is a client/input error → NOT retryable (don't burn quota).
 *  - 5xx is a server hiccup → retryable.
 */
function isRetryableStatus(status: number): boolean {
  if (status === 408 || status === 429) return true;
  if (status >= 400 && status < 500) return false;
  return status >= 500;
}

/**
 * Parse the provider's Retry-After signal. Prefers the more precise
 * `retry-after-ms` (used by OpenAI), then standard `Retry-After` (seconds or
 * HTTP-date). Returns undefined when there is no usable header.
 */
function parseRetryAfter(headers: Headers): number | undefined {
  const ms = headers.get('retry-after-ms');
  if (ms) {
    const t = parseFloat(ms);
    if (!Number.isNaN(t) && t >= 0) return t;
  }

  const ra = headers.get('retry-after');
  if (ra) {
    const seconds = parseFloat(ra);
    if (!Number.isNaN(seconds) && seconds >= 0) return seconds * 1000;
    // HTTP-date form
    const dateMs = Date.parse(ra);
    if (!Number.isNaN(dateMs)) {
      const diff = dateMs - Date.now();
      if (diff >= 0) return diff;
    }
  }
  return undefined;
}

export class ResilientTransport {
  private readonly cfg: Required<TransportConfig>;

  constructor(config: TransportConfig = {}) {
    this.cfg = { ...DEFAULTS, ...config };
  }

  /**
   * Computes the wait before the next attempt. A usable header wins (clamped to
   * maxDelayMs); otherwise exponential backoff with full jitter.
   */
  private computeBackoff(attempt: number, headerMs: number | undefined): number {
    const exponential = Math.min(this.cfg.baseDelayMs * 2 ** attempt, this.cfg.maxDelayMs);
    if (headerMs !== undefined) {
      // Clamp so a hostile/wrong header can't block us for minutes.
      return Math.min(Math.max(headerMs, 0), this.cfg.maxDelayMs);
    }
    // Full jitter: random in [0, exponential] to avoid thundering-herd alignment.
    return Math.round(Math.random() * exponential);
  }

  /** One raw attempt. Throws TransportHttpError on non-OK, or fetch errors as-is. */
  private async attempt(url: string, opts: ResilientRequestOptions): Promise<Response> {
    const timeoutMs = opts.timeoutMs ?? this.cfg.defaultTimeoutMs;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal;

    const init: RequestInit = {
      method: opts.method ?? 'GET',
      signal,
    };
    if (opts.headers) init.headers = opts.headers;
    if (opts.body !== undefined) init.body = opts.body;

    const res = await fetch(url, init);

    if (!res.ok) {
      const bodyText = await res.text().catch(() => res.statusText);
      const retryAfterMs = parseRetryAfter(res.headers);
      throw new TransportHttpError(
        res.status,
        bodyText,
        isRetryableStatus(res.status),
        retryAfterMs,
      );
    }

    return res;
  }

  /**
   * Fetch with header-aware retry + backoff. Returns the raw Response on success.
   * Throws the last error (TransportHttpError or network error) when retries are
   * exhausted, or immediately on a non-retryable error / abort.
   */
  async fetchWithRetry(url: string, opts: ResilientRequestOptions = {}): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.cfg.maxRetries; attempt++) {
      try {
        return await this.attempt(url, opts);
      } catch (error) {
        lastError = error;

        // Caller aborted (or attempt timed out via the caller's signal): never retry.
        if (opts.signal?.aborted) throw error;
        if (isAbortError(error) && opts.signal?.aborted) throw error;

        // TransportHttpError carries the per-status decision. Everything else
        // (DNS failure, ECONNRESET, per-attempt timeout) is a network-level
        // hiccup that is worth retrying.
        const retryable = error instanceof TransportHttpError ? error.isRetryable : true;

        const isLastAttempt = attempt === this.cfg.maxRetries;
        if (!retryable || isLastAttempt) throw error;

        const headerMs = error instanceof TransportHttpError ? error.retryAfterMs : undefined;
        const waitMs = this.computeBackoff(attempt, headerMs);

        logger.warn('[Transport] retrying request after transient failure', {
          url: url.split('?')[0],
          attempt: attempt + 1,
          maxRetries: this.cfg.maxRetries,
          waitMs,
          status: error instanceof TransportHttpError ? error.status : undefined,
        });

        try {
          await delay(waitMs, undefined, opts.signal ? { signal: opts.signal } : undefined);
        } catch {
          // Sleep aborted by the caller → stop retrying.
          throw lastError;
        }
      }
    }

    // Unreachable, but satisfies the type checker.
    throw lastError;
  }

  /**
   * Convenience: POST a JSON body and parse a JSON response with the resilient
   * pipeline. Defensive parse — never a bare JSON.parse on provider output.
   *
   * Pass a `schema` (any zod schema) to validate the provider's payload at the
   * boundary: the parsed JSON is run through `safeParse` and a validation
   * failure throws a `TransportHttpError` instead of letting an unexpected shape
   * leak downstream as an unchecked `as T` cast. Without a schema the JSON is
   * still parsed defensively (non-JSON bodies throw), but the caller owns the
   * type assertion — prefer passing a schema for external provider responses.
   */
  async fetchJson<T = unknown>(
    url: string,
    opts: ResilientRequestOptions = {},
    schema?: ResponseValidator<T>,
  ): Promise<T> {
    const start = performance.now();
    const res = await this.fetchWithRetry(url, opts);
    const text = await res.text();
    const elapsed = Math.round(performance.now() - start);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new TransportHttpError(
        res.status,
        `Provider returned non-JSON body: ${text.slice(0, 200)}`,
        false,
      );
    }

    if (schema) {
      const result = schema.safeParse(parsed);
      if (!result.success) {
        throw new TransportHttpError(
          res.status,
          `Provider returned an unexpected JSON shape: ${result.error.message}`,
          false,
        );
      }
      logger.debug('[Transport] request ok (validated)', {
        url: url.split('?')[0],
        elapsedMs: elapsed,
      });
      return result.data;
    }

    logger.debug('[Transport] request ok', { url: url.split('?')[0], elapsedMs: elapsed });
    return parsed as T;
  }
}

/**
 * Shared default instance. Plugins import this singleton so every provider call
 * goes through the same retry/backoff policy and observability.
 */
export const resilientTransport = new ResilientTransport();
