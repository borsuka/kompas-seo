import { describe, expect, it } from 'vitest';
import { MemoryCacheStore } from './cache.js';
import { describeCall } from './decorate.js';
import { createProviders, type ProviderEnv } from './factory.js';
import { MemoryUsageSink } from './usage.js';

const env: ProviderEnv = {
  KEYWORD_PROVIDER: 'mock',
  SERP_PROVIDER: 'mock',
  DOMAIN_PROVIDER: 'mock',
  BACKLINK_PROVIDER: 'mock',
};

describe('createProviders', () => {
  it('builds a fully working mock provider set without any keys', async () => {
    const usage = new MemoryUsageSink();
    const cache = new MemoryCacheStore();
    const p = createProviders({ env, cache, usage });
    const loc = { locationCode: 2100, languageCode: 'bg' } as const;

    const [m] = await p.keywords.getKeywordMetrics(['seo оптимизация'], loc);
    expect(m!.keyword).toBe('seo оптимизация');
    await p.serp.getSerp('seo', loc, 'mobile', 20);
    await p.domains.getCompetitors('example.bg', loc);
    await p.backlinks.getBacklinkSummary('example.bg');

    expect(usage.events.map((e) => e.endpoint)).toEqual([
      'keywords.getKeywordMetrics',
      'serp.getSerp',
      'domains.getCompetitors',
      'backlinks.getBacklinkSummary',
    ]);
    expect(cache.size).toBe(4);
    expect(p.keywords.name).toBe('mock');
  });

  it('fails fast when DataForSEO is selected without credentials', () => {
    expect(() =>
      createProviders({
        env: {
          ...env,
          BACKLINK_PROVIDER: 'dataforseo',
          DATAFORSEO_LOGIN: undefined,
          DATAFORSEO_PASSWORD: undefined,
        },
        cache: new MemoryCacheStore(),
        usage: new MemoryUsageSink(),
      }),
    ).toThrow(/DATAFORSEO_LOGIN/);
  });
});

describe('describeCall', () => {
  it('prices calls by operation and units', () => {
    expect(describeCall('keywords', 'getKeywordMetrics', [['a', 'b', 'c'], {}])).toMatchObject({
      operation: 'keyword.metrics',
      units: 3,
    });
    expect(describeCall('serp', 'getSerp', ['a', {}, 'desktop', 100])).toMatchObject({
      operation: 'serp.get',
      units: 100,
      ttlSec: 86_400,
    });
    expect(() => describeCall('serp', 'nope', [])).toThrow();
  });
});
