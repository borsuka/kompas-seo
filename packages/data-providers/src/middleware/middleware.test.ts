import { describe, expect, it, vi } from 'vitest';
import { AppError, DEFAULT_CREDIT_COSTS } from '@seo/shared';
import { MemoryCacheStore } from '../cache.js';
import { withProviderContext } from '../context.js';
import { decorateProvider } from '../decorate.js';
import { ProviderError, ProviderUnavailableError } from '../errors.js';
import type { SerpProvider } from '../types.js';
import { MemoryUsageSink } from '../usage.js';
import { withCache } from './cache.js';
import { CircuitBreaker, withCircuitBreaker } from './circuit-breaker.js';
import { withDedup } from './dedup.js';
import { backoffDelay, withRetry } from './retry.js';
import { withUsageRecording } from './usage.js';
import type { Middleware } from './types.js';
import { reportProviderCost } from '../context.js';

const loc = { locationCode: 2100, languageCode: 'bg' } as const;

function fakeSerp(impl: (keyword: string) => Promise<unknown>): SerpProvider {
  return { name: 'fake', getSerp: (keyword) => impl(keyword) as never };
}

const noSleep = () => Promise.resolve();

describe('withCache', () => {
  it('serves the second identical call from cache', async () => {
    const store = new MemoryCacheStore();
    const impl = vi.fn(async (k: string) => ({ keyword: k }));
    const serp = decorateProvider('serp', fakeSerp(impl), [withCache(store)]);
    await serp.getSerp('a', loc, 'desktop', 10);
    await serp.getSerp('a', loc, 'desktop', 10);
    await serp.getSerp('a', loc, 'mobile', 10);
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('bypasses cached responses in refresh mode but stores the fresh one', async () => {
    const store = new MemoryCacheStore();
    let n = 0;
    const impl = vi.fn(async () => ({ n: ++n }));
    const serp = decorateProvider('serp', fakeSerp(impl), [withCache(store)]);
    await serp.getSerp('a', loc, 'desktop', 100);
    const fresh = await withProviderContext({ orgId: 'o', cache: 'refresh' }, () =>
      serp.getSerp('a', loc, 'desktop', 100),
    );
    expect(fresh).toEqual({ n: 2 });
    expect(await serp.getSerp('a', loc, 'desktop', 100)).toEqual({ n: 2 });
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('expires entries after the TTL', async () => {
    let t = 0;
    const store = new MemoryCacheStore(() => t);
    const impl = vi.fn(async () => ({}));
    const serp = decorateProvider('serp', fakeSerp(impl), [withCache(store)]);
    await serp.getSerp('a', loc, 'desktop', 10);
    t += 86_400_000 + 1; // SERP TTL is 1 day
    await serp.getSerp('a', loc, 'desktop', 10);
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('survives a broken cache store', async () => {
    const broken = new MemoryCacheStore();
    broken.get = () => Promise.reject(new Error('redis down'));
    const onError = vi.fn();
    const serp = decorateProvider(
      'serp',
      fakeSerp(async () => ({ ok: true })),
      [withCache(broken, onError)],
    );
    await expect(serp.getSerp('a', loc, 'desktop', 10)).resolves.toEqual({ ok: true });
    expect(onError).toHaveBeenCalled();
  });
});

describe('withDedup', () => {
  it('collapses concurrent identical calls into one upstream request', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const impl = vi.fn(async (k: string) => {
      await gate;
      return { keyword: k };
    });
    const serp = decorateProvider('serp', fakeSerp(impl), [withDedup()]);
    const calls = Array.from({ length: 5 }, () => serp.getSerp('same', loc, 'desktop', 10));
    const other = serp.getSerp('different', loc, 'desktop', 10);
    release();
    const results = await Promise.all([...calls, other]);
    expect(impl).toHaveBeenCalledTimes(2);
    expect(results.slice(0, 5).every((r) => (r as { keyword: string }).keyword === 'same')).toBe(
      true,
    );
  });

  it('waits for another process holding the lock and reads its cached result', async () => {
    const store = new MemoryCacheStore();
    const impl = vi.fn(async () => ({ fresh: true }));
    const serp = decorateProvider('serp', fakeSerp(impl), [
      withDedup({ store, pollIntervalMs: 2, waitTimeoutMs: 2000 }),
      withCache(store),
    ]);
    // Simulate another process: it holds the lock, then writes the cache.
    const keyProbe: string[] = [];
    const probe: Middleware = async (call, next) => {
      keyProbe.push(call.key);
      return next();
    };
    const probeSerp = decorateProvider('serp', fakeSerp(impl), [probe]);
    await probeSerp.getSerp('x', loc, 'desktop', 10);
    const key = keyProbe[0]!;
    await store.tryLock(key, 60_000);
    setTimeout(() => void store.set(key, JSON.stringify({ fromOther: true }), 60), 5);

    await expect(serp.getSerp('x', loc, 'desktop', 10)).resolves.toEqual({ fromOther: true });
    expect(impl).toHaveBeenCalledTimes(1); // only the probe call
  });
});

describe('withRetry', () => {
  it('retries retriable errors with backoff, then succeeds', async () => {
    const sleep = vi.fn((_ms: number) => Promise.resolve());
    let n = 0;
    const serp = decorateProvider(
      'serp',
      fakeSerp(async () => {
        if (++n < 3) throw ProviderError.fromHttpStatus(503, 'busy');
        return { ok: n };
      }),
      [withRetry({ retries: 3, sleep, random: () => 1, baseDelayMs: 100 })],
    );
    await expect(serp.getSerp('a', loc, 'desktop', 10)).resolves.toEqual({ ok: 3 });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 200]);
  });

  it('does not retry non-retriable errors', async () => {
    const impl = vi.fn(async () => {
      throw ProviderError.fromHttpStatus(400, 'bad request');
    });
    const serp = decorateProvider('serp', fakeSerp(impl), [withRetry({ sleep: noSleep })]);
    await expect(serp.getSerp('a', loc, 'desktop', 10)).rejects.toThrow('bad request');
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('gives up after the configured retries', async () => {
    const impl = vi.fn(async () => {
      throw ProviderError.fromHttpStatus(500, 'boom');
    });
    const serp = decorateProvider('serp', fakeSerp(impl), [
      withRetry({ retries: 2, sleep: noSleep }),
    ]);
    await expect(serp.getSerp('a', loc, 'desktop', 10)).rejects.toThrow('boom');
    expect(impl).toHaveBeenCalledTimes(3);
  });

  it('caps the backoff delay', () => {
    const opts = { retries: 10, baseDelayMs: 500, maxDelayMs: 8000, random: () => 1 };
    expect(backoffDelay(0, opts)).toBe(500);
    expect(backoffDelay(3, opts)).toBe(4000);
    expect(backoffDelay(10, opts)).toBe(8000);
  });
});

describe('CircuitBreaker', () => {
  it('opens after consecutive failures, half-opens after cooldown, closes on success', async () => {
    let t = 0;
    const breaker = new CircuitBreaker('fake', {
      failureThreshold: 2,
      cooldownMs: 1000,
      now: () => t,
    });
    let fail = true;
    const impl = vi.fn(async () => {
      if (fail) throw ProviderError.fromHttpStatus(502, 'bad gateway');
      return { ok: true };
    });
    const serp = decorateProvider('serp', fakeSerp(impl), [withCircuitBreaker(breaker)]);
    const call = () => serp.getSerp('a', loc, 'desktop', 10);

    await expect(call()).rejects.toThrow('bad gateway');
    expect(breaker.currentState).toBe('closed');
    await expect(call()).rejects.toThrow('bad gateway');
    expect(breaker.currentState).toBe('open');

    await expect(call()).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(impl).toHaveBeenCalledTimes(2);

    t += 1000;
    expect(breaker.currentState).toBe('half-open');
    await expect(call()).rejects.toThrow('bad gateway'); // trial fails → open again
    expect(breaker.currentState).toBe('open');

    t += 1000;
    fail = false;
    await expect(call()).resolves.toEqual({ ok: true });
    expect(breaker.currentState).toBe('closed');
  });

  it('ignores business errors', async () => {
    const breaker = new CircuitBreaker('fake', { failureThreshold: 1 });
    const serp = decorateProvider(
      'serp',
      fakeSerp(async () => {
        throw new AppError('VALIDATION_FAILED', 'nope');
      }),
      [withCircuitBreaker(breaker)],
    );
    await expect(serp.getSerp('a', loc, 'desktop', 10)).rejects.toThrow('nope');
    expect(breaker.currentState).toBe('closed');
  });
});

describe('withUsageRecording', () => {
  it('records org, cost, credits and cache status for every call', async () => {
    const sink = new MemoryUsageSink();
    const store = new MemoryCacheStore();
    const serp = decorateProvider(
      'serp',
      fakeSerp(async () => {
        reportProviderCost(0.002);
        return { ok: true };
      }),
      [withUsageRecording(sink, DEFAULT_CREDIT_COSTS), withCache(store)],
    );
    await withProviderContext({ orgId: 'org_1' }, () => serp.getSerp('a', loc, 'desktop', 100));
    await withProviderContext({ orgId: 'org_1' }, () => serp.getSerp('a', loc, 'desktop', 100));

    expect(sink.events).toHaveLength(2);
    expect(sink.events[0]).toMatchObject({
      orgId: 'org_1',
      provider: 'fake',
      endpoint: 'serp.getSerp',
      costUsd: 0.002,
      credits: 5,
      cached: false,
      success: true,
    });
    expect(sink.events[1]).toMatchObject({ cached: true, costUsd: 0 });
  });

  it('records failures', async () => {
    const sink = new MemoryUsageSink();
    const serp = decorateProvider(
      'serp',
      fakeSerp(async () => {
        throw new Error('x');
      }),
      [withUsageRecording(sink, DEFAULT_CREDIT_COSTS)],
    );
    await expect(serp.getSerp('a', loc, 'desktop', 10)).rejects.toThrow();
    expect(sink.events[0]).toMatchObject({ success: false, orgId: 'system' });
  });
});
