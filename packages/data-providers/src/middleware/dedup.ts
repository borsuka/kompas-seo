import type { CacheStore } from '../cache.js';
import type { Middleware } from './types.js';

export interface DedupOptions {
  /** Cross-process lock store (Redis). Without it only in-process dedup applies. */
  store?: CacheStore;
  lockTtlMs?: number;
  /** How long a process that lost the lock waits for the winner's cached result. */
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Collapses concurrent identical calls into one upstream request.
 * In-process: callers share one promise. Cross-process: the first process takes a
 * short Redis lock; others poll the cache for its result, then fall through.
 * Must run before the cache middleware in the chain.
 */
export function withDedup(opts: DedupOptions = {}): Middleware {
  const inflight = new Map<string, Promise<unknown>>();
  const sleep = opts.sleep ?? defaultSleep;
  const lockTtlMs = opts.lockTtlMs ?? 30_000;
  const waitTimeoutMs = opts.waitTimeoutMs ?? 10_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 200;

  return async (call, next) => {
    const existing = inflight.get(call.key);
    if (existing) {
      call.meta.deduped = true;
      call.meta.cached = true;
      return existing;
    }

    const run = async () => {
      const store = opts.store;
      if (!store) return next();

      const locked = await store.tryLock(call.key, lockTtlMs).catch(() => true);
      if (locked) {
        try {
          return await next();
        } finally {
          await store.unlock(call.key).catch(() => undefined);
        }
      }
      // Another process is fetching the same data: wait for it to land in the cache.
      const deadline = Date.now() + waitTimeoutMs;
      while (Date.now() < deadline) {
        await sleep(pollIntervalMs);
        const hit = await store.get(call.key).catch(() => null);
        if (hit !== null) {
          call.meta.deduped = true;
          call.meta.cached = true;
          return JSON.parse(hit) as unknown;
        }
      }
      return next();
    };

    const promise = run().finally(() => inflight.delete(call.key));
    inflight.set(call.key, promise);
    return promise;
  };
}
