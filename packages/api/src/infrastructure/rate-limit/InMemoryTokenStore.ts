import { TokenStore } from '../../core/interfaces/TokenStore.js';

interface TokenRecord {
  tokensConsumed: number;
  resetTime: number;
}

/**
 * Native Memory-based Token Store for Rate Limiting.
 * Built-in over dependencies: uses a native Map instead of Redis.
 */
export class InMemoryTokenStore implements TokenStore {
  private cache = new Map<string, TokenRecord>();

  constructor() {
    // Periodically clean up expired records to prevent memory leaks
    setInterval(() => {
      const now = Date.now();
      for (const [key, record] of this.cache.entries()) {
        if (now > record.resetTime) {
          this.cache.delete(key);
        }
      }
    }, 60000).unref();
  }

  public async consume(identifier: string, tokens: number, windowMs: number): Promise<void> {
    const now = Date.now();
    const record = this.cache.get(identifier);

    if (!record || now > record.resetTime) {
      this.cache.set(identifier, {
        tokensConsumed: tokens,
        resetTime: now + windowMs,
      });
      return;
    }

    record.tokensConsumed += tokens;
  }

  public async getConsumedTokens(identifier: string, _windowMs: number): Promise<number> {
    const now = Date.now();
    const record = this.cache.get(identifier);

    // If no record exists or the window expired, consumed tokens is 0
    if (!record || now > record.resetTime) {
      return 0;
    }

    return record.tokensConsumed;
  }
}
