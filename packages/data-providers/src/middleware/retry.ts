import { isRetriable } from '../errors.js';
import type { Middleware } from './types.js';

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** delay = random(0, min(max, base * 2^attempt)) — "full jitter" exponential backoff. */
export function backoffDelay(attempt: number, opts: Required<Omit<RetryOptions, 'sleep'>>): number {
  const cap = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** attempt);
  return Math.round(opts.random() * cap);
}

export function withRetry(options: RetryOptions = {}): Middleware {
  const opts = {
    retries: options.retries ?? 3,
    baseDelayMs: options.baseDelayMs ?? 500,
    maxDelayMs: options.maxDelayMs ?? 8_000,
    random: options.random ?? Math.random,
  };
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  return async (call, next) => {
    for (let attempt = 0; ; attempt++) {
      call.meta.attempts = attempt + 1;
      try {
        return await next();
      } catch (err) {
        if (attempt >= opts.retries || !isRetriable(err)) throw err;
        await sleep(backoffDelay(attempt, opts));
      }
    }
  };
}
