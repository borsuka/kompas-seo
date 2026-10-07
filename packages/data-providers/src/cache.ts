import type { Redis } from 'ioredis';

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  /** Acquire a short-lived lock; resolves false if someone else holds it. */
  tryLock(key: string, ttlMs: number): Promise<boolean>;
  unlock(key: string): Promise<void>;
}

export class RedisCacheStore implements CacheStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'prov:',
  ) {}

  get(key: string) {
    return this.redis.get(this.prefix + key);
  }

  async set(key: string, value: string, ttlSec: number) {
    await this.redis.set(this.prefix + key, value, 'EX', ttlSec);
  }

  async tryLock(key: string, ttlMs: number) {
    return (await this.redis.set(`${this.prefix}lock:${key}`, '1', 'PX', ttlMs, 'NX')) === 'OK';
  }

  async unlock(key: string) {
    await this.redis.del(`${this.prefix}lock:${key}`);
  }
}

/** In-process cache for tests and single-process tools. */
export class MemoryCacheStore implements CacheStore {
  private readonly data = new Map<string, { value: string; expiresAt: number }>();
  private readonly locks = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  async get(key: string) {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.data.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSec: number) {
    this.data.set(key, { value, expiresAt: this.now() + ttlSec * 1000 });
  }

  async tryLock(key: string, ttlMs: number) {
    const until = this.locks.get(key);
    if (until && until > this.now()) return false;
    this.locks.set(key, this.now() + ttlMs);
    return true;
  }

  async unlock(key: string) {
    this.locks.delete(key);
  }

  get size() {
    return this.data.size;
  }
}
