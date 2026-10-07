import { AppError, resolveCreditCosts } from '@seo/shared';
import type { CacheStore } from './cache.js';
import { decorateProvider } from './decorate.js';
import { withCache } from './middleware/cache.js';
import {
  CircuitBreaker,
  withCircuitBreaker,
  type BreakerState,
} from './middleware/circuit-breaker.js';
import { withDedup } from './middleware/dedup.js';
import { withRetry, type RetryOptions } from './middleware/retry.js';
import type { Middleware } from './middleware/types.js';
import { withUsageRecording } from './middleware/usage.js';
import { MockProvider } from './mock/mock-provider.js';
import type { ProviderKind, ProviderSet } from './types.js';
import type { UsageSink } from './usage.js';

export type ProviderImpl = 'mock' | 'dataforseo';

export interface ProviderEnv {
  KEYWORD_PROVIDER: ProviderImpl;
  SERP_PROVIDER: ProviderImpl;
  DOMAIN_PROVIDER: ProviderImpl;
  BACKLINK_PROVIDER: ProviderImpl;
  CREDIT_COSTS_JSON?: string | undefined;
}

export interface CreateProvidersOptions {
  env: ProviderEnv;
  cache: CacheStore;
  usage: UsageSink;
  retry?: RetryOptions;
  /** Override raw implementations (tests). */
  overrides?: Partial<ProviderSet>;
  logger?: {
    warn: (obj: object, msg: string) => void;
  };
}

const ENV_KEY: Record<ProviderKind, keyof ProviderEnv> = {
  keywords: 'KEYWORD_PROVIDER',
  serp: 'SERP_PROVIDER',
  domains: 'DOMAIN_PROVIDER',
  backlinks: 'BACKLINK_PROVIDER',
};

function rawProvider<K extends ProviderKind>(
  kind: K,
  impl: ProviderImpl,
  mock: MockProvider,
): ProviderSet[K] {
  switch (impl) {
    case 'mock':
      return mock as ProviderSet[K];
    case 'dataforseo':
      throw new AppError(
        'PROVIDER_NOT_CONFIGURED',
        `DataForSEO provider for "${kind}" is not implemented yet. Set ${ENV_KEY[kind]}=mock.`,
      );
  }
}

/**
 * Builds the decorated provider set. Chain (outer → inner):
 * usage recording → dedup → cache → circuit breaker → retry → implementation.
 * Credits are charged one level above, in the API/worker gateway, because they need
 * the organization context and must happen before any work starts.
 */
export function createProviders(opts: CreateProvidersOptions): ProviderSet {
  const creditCosts = resolveCreditCosts(opts.env.CREDIT_COSTS_JSON);
  const mock = new MockProvider();
  const onStateChange = (state: BreakerState, provider: string) =>
    opts.logger?.warn({ provider, state }, 'provider circuit breaker state changed');
  const onCacheError = (err: unknown) => opts.logger?.warn({ err }, 'provider cache error');

  const build = <K extends ProviderKind>(kind: K): ProviderSet[K] => {
    const impl =
      opts.overrides?.[kind] ?? rawProvider(kind, opts.env[ENV_KEY[kind]] as ProviderImpl, mock);
    const breaker = new CircuitBreaker(`${impl.name}:${kind}`, { onStateChange });
    const chain: Middleware[] = [
      withUsageRecording(opts.usage, creditCosts),
      withDedup({ store: opts.cache }),
      withCache(opts.cache, onCacheError),
      withCircuitBreaker(breaker),
      withRetry(opts.retry),
    ];
    return decorateProvider(kind, impl as ProviderSet[K], chain);
  };

  return {
    keywords: build('keywords'),
    serp: build('serp'),
    domains: build('domains'),
    backlinks: build('backlinks'),
  };
}
