// Stability: 2 - Stable
import { EventEmitter } from 'node:events';
import { logger } from './logger.js';

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold: number; // Number of failures before opening
  resetTimeoutMs: number; // Time to wait before entering HALF_OPEN
  requestTimeoutMs?: number; // Timeout for the action itself
}

/**
 * Native Circuit Breaker Implementation
 * Protects external API calls (e.g., OpenAI, Gemini) from cascade failures.
 */
export class CircuitBreaker extends EventEmitter {
  private state: CircuitBreakerState = 'CLOSED';
  private failureCount: number = 0;
  private nextAttempt: number = Date.now();
  /** True while a single HALF_OPEN probe is in flight, so concurrent callers fast-fail. */
  private halfOpenInFlight: boolean = false;

  constructor(
    private readonly name: string,
    private readonly options: CircuitBreakerOptions,
  ) {
    super();
  }

  public getState(): CircuitBreakerState {
    return this.state;
  }

  public async fire<T>(action: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() > this.nextAttempt) {
        this.transitionTo('HALF_OPEN');
        // This caller becomes the single probe; later concurrent callers fast-fail below.
        this.halfOpenInFlight = true;
      } else {
        throw new Error(`CircuitBreaker [${this.name}] is OPEN. Fast-failing.`);
      }
    } else if (this.state === 'HALF_OPEN' && this.halfOpenInFlight) {
      // A probe is already testing recovery; do not pile a thundering herd onto
      // the recovering backend. Only one request is allowed through HALF_OPEN.
      throw new Error(
        `CircuitBreaker [${this.name}] is HALF_OPEN (probe in flight). Fast-failing.`,
      );
    }

    try {
      const result = await this.executeAction(action);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error as Error);
      throw error;
    }
  }

  private async executeAction<T>(action: () => Promise<T>): Promise<T> {
    if (!this.options.requestTimeoutMs) {
      return action();
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `CircuitBreaker [${this.name}] action timed out after ${this.options.requestTimeoutMs}ms`,
          ),
        );
      }, this.options.requestTimeoutMs);

      action()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      logger.info(`CircuitBreaker [${this.name}] succeeded in HALF_OPEN state. Closing circuit.`);
      this.halfOpenInFlight = false;
      this.transitionTo('CLOSED');
    }
    this.failureCount = 0;
  }

  private onFailure(error: Error): void {
    this.failureCount += 1;
    logger.warn(`CircuitBreaker [${this.name}] failed. Count: ${this.failureCount}`, {
      error: error.message,
    });

    if (this.state === 'HALF_OPEN' || this.failureCount >= this.options.failureThreshold) {
      // The probe failed (or we tripped open): release the flag so the next
      // window's probe can run after the reset timeout.
      this.halfOpenInFlight = false;
      this.transitionTo('OPEN');
    }
  }

  private transitionTo(newState: CircuitBreakerState): void {
    const oldState = this.state;
    this.state = newState;

    if (newState === 'OPEN') {
      this.nextAttempt = Date.now() + this.options.resetTimeoutMs;
    }

    if (oldState !== newState) {
      this.emit('stateChange', { name: this.name, oldState, newState });
      logger.info(`CircuitBreaker [${this.name}] transitioned from ${oldState} to ${newState}`);
    }
  }
}
