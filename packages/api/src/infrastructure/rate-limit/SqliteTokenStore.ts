import { TokenStore } from '../../core/interfaces/TokenStore.js';
import { updateRateLimitToken, getRateLimitToken } from '../database/db.js';

/**
 * SQLite-based Token Store for Rate Limiting.
 * Built-in over dependencies: uses local SQLite to persist budgets across deployments.
 */
export class SqliteTokenStore implements TokenStore {
  public async consume(identifier: string, tokens: number, windowMs: number): Promise<void> {
    const now = Date.now();
    const record = getRateLimitToken(identifier);

    if (!record || now > parseInt(record.lastRefill, 10)) {
      updateRateLimitToken(identifier, tokens, (now + windowMs).toString());
      return;
    }

    updateRateLimitToken(identifier, record.tokens + tokens, record.lastRefill);
  }

  public async getConsumedTokens(identifier: string, _windowMs: number): Promise<number> {
    const now = Date.now();
    const record = getRateLimitToken(identifier);

    if (!record || now > parseInt(record.lastRefill, 10)) {
      return 0;
    }

    return record.tokens;
  }
}
