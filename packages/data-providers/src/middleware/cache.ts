import type { CacheStore } from '../cache.js';
import { getProviderContext } from '../context.js';
import type { Middleware } from './types.js';

/** Read-through cache with per-data-type TTL. Cache failures never fail the request. */
export function withCache(store: CacheStore, onError?: (err: unknown) => void): Middleware {
  return async (call, next) => {
    if (getProviderContext()?.cache !== 'refresh') {
      try {
        const hit = await store.get(call.key);
        if (hit !== null) {
          call.meta.cached = true;
          return JSON.parse(hit) as unknown;
        }
      } catch (err) {
        onError?.(err);
      }
    }

    const value = await next();
    try {
      await store.set(call.key, JSON.stringify(value), call.ttlSec);
    } catch (err) {
      onError?.(err);
    }
    return value;
  };
}
