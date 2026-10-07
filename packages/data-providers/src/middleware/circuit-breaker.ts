import { isRetriable, ProviderUnavailableError } from '../errors.js';
import type { Middleware } from './types.js';

export type BreakerState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Consecutive upstream failures that open the circuit. */
  failureThreshold?: number;
  /** How long the circuit stays open before a trial request is allowed. */
  cooldownMs?: number;
  now?: () => number;
  onStateChange?: (state: BreakerState, provider: string) => void;
}

/**
 * Fails fast while an upstream provider is down. Only upstream/transient errors count
 * as failures; validation and business errors pass through without tripping it.
 */
export class CircuitBreaker {
  private state: BreakerState = 'closed';
  private failures = 0;
  private openedAt = 0;
  private trialInFlight = false;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(
    private readonly name: string,
    private readonly opts: CircuitBreakerOptions = {},
  ) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }

  get currentState(): BreakerState {
    if (this.state === 'open' && this.now() - this.openedAt >= this.cooldownMs) return 'half-open';
    return this.state;
  }

  private transition(state: BreakerState) {
    if (this.state !== state) {
      this.state = state;
      this.opts.onStateChange?.(state, this.name);
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.currentState;
    if (state === 'open' || (state === 'half-open' && this.trialInFlight)) {
      throw new ProviderUnavailableError(this.name, this.cooldownMs - (this.now() - this.openedAt));
    }
    if (state === 'half-open') {
      this.transition('half-open');
      this.trialInFlight = true;
    }

    try {
      const result = await fn();
      this.failures = 0;
      this.transition('closed');
      return result;
    } catch (err) {
      if (isRetriable(err)) {
        this.failures++;
        if (this.state === 'half-open' || this.failures >= this.failureThreshold) {
          this.openedAt = this.now();
          this.transition('open');
        }
      }
      throw err;
    } finally {
      if (state === 'half-open') this.trialInFlight = false;
    }
  }
}

export function withCircuitBreaker(breaker: CircuitBreaker): Middleware {
  return (_call, next) => breaker.execute(next);
}
