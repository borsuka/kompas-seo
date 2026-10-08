import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { KeywordMetrics, SerpSnapshot } from '@seo/shared';
import { clickhouseEnvSchema, loadRootEnv, parseEnv } from '@seo/shared/server';
import { clickhouseMigrationsFolder } from '../migrations.js';
import { clickHouseConfigFromEnv, createClickHouse, type ClickHouseClient } from './client.js';
import {
  getStoredMetrics,
  ideaSetFetchedAt,
  insertIdeaSet,
  insertKeywordMetrics,
  insertSerpSnapshot,
  latestSerp,
  latestTopUrls,
  queryIdeas,
} from './keyword-store.js';
import { migrateClickHouse } from './migrate.js';

// Integration test: needs ClickHouse from docker compose (uses the *_test database).
loadRootEnv();
const config = clickHouseConfigFromEnv(
  parseEnv(clickhouseEnvSchema, {
    ...process.env,
    // Own database: API integration tests truncate seo_test and may run in parallel.
    CLICKHOUSE_DATABASE: 'seo_store_test',
  }),
);
const loc = { locationCode: 2100, languageCode: 'bg' } as const;
let ch: ClickHouseClient;

const metric = (
  keyword: string,
  volume: number,
  extra: Partial<KeywordMetrics> = {},
): KeywordMetrics => ({
  keyword,
  locationCode: loc.locationCode,
  languageCode: loc.languageCode,
  volume,
  cpc: 1.2,
  competition: 0.5,
  competitionLevel: 'medium',
  trend: Array.from({ length: 24 }, (_, i) => ({
    year: 2024 + Math.floor((i + 9) / 12),
    month: ((i + 9) % 12) + 1,
    volume: i,
  })),
  kd: 30,
  intent: ['informational'],
  serpFeatures: ['people_also_ask'],
  updatedAt: new Date().toISOString(),
  ...extra,
});

beforeAll(async () => {
  await migrateClickHouse(config, clickhouseMigrationsFolder, () => undefined);
  ch = createClickHouse(config);
  for (const table of ['keywords', 'keyword_idea_sets', 'serp_snapshots']) {
    await ch.command({ query: 'TRUNCATE TABLE IF EXISTS ' + table });
  }
});
afterAll(async () => {
  await ch?.close();
});

describe('keyword store', () => {
  it('stores metrics and reads them back with the trend', async () => {
    await insertKeywordMetrics(ch, [metric('seo оптимизация', 1900)], 'mock');
    const map = await getStoredMetrics(ch, ['seo оптимизация', 'missing'], loc, 30);
    expect([...map.keys()]).toEqual(['seo оптимизация']);
    const m = map.get('seo оптимизация')!;
    expect(m.volume).toBe(1900);
    expect(m.trend).toHaveLength(24);
    expect(m.trend[0]).toEqual({ year: 2024, month: 10, volume: 0 });
  });

  it('filters, sorts and pages explorer ideas server-side', async () => {
    const seed = 'обувки';
    await insertKeywordMetrics(
      ch,
      [
        metric('обувки', 5000, { kd: 60, intent: ['commercial'] }),
        metric('купи обувки онлайн', 900, {
          kd: 20,
          intent: ['transactional'],
          serpFeatures: ['shopping'],
        }),
        metric('евтини обувки', 700, { kd: 25, intent: ['transactional'] }),
        metric('как да изберем обувки', 300, { kd: 10, intent: ['informational'] }),
      ],
      'mock',
    );
    await insertIdeaSet(
      ch,
      seed,
      loc,
      [
        { keyword: 'обувки', source: 'matching' },
        { keyword: 'купи обувки онлайн', source: 'matching' },
        { keyword: 'евтини обувки', source: 'related' },
        { keyword: 'как да изберем обувки', source: 'question' },
      ],
      'mock',
    );
    expect(await ideaSetFetchedAt(ch, seed, loc, 30)).toBeInstanceOf(Date);
    expect(await ideaSetFetchedAt(ch, 'never-fetched', loc, 30)).toBeNull();

    const base = {
      seed,
      loc,
      filters: { intents: [], include: [], exclude: [], features: [] },
      sort: 'volume' as const,
      dir: 'desc' as const,
      limit: 2,
      offset: 0,
    };
    const page1 = await queryIdeas(ch, base);
    expect(page1.total).toBe(4);
    expect(page1.items.map((i) => i.keyword)).toEqual(['обувки', 'купи обувки онлайн']);
    expect(page1.sourceCounts).toEqual({ matching: 2, related: 1, question: 1 });
    expect(page1.items[0]!.trend).toHaveLength(12);

    const filtered = await queryIdeas(ch, {
      ...base,
      limit: 50,
      filters: {
        maxKd: 30,
        minVolume: 500,
        intents: ['transactional'],
        include: ['ОБУВКИ'],
        exclude: ['онлайн'],
        features: [],
      },
    });
    expect(filtered.items.map((i) => i.keyword)).toEqual(['евтини обувки']);

    const questions = await queryIdeas(ch, { ...base, source: 'question', limit: 50 });
    expect(questions.items.map((i) => i.keyword)).toEqual(['как да изберем обувки']);
    expect(questions.total).toBe(1);

    const withFeature = await queryIdeas(ch, {
      ...base,
      limit: 50,
      sort: 'kd',
      dir: 'asc',
      filters: { ...base.filters, features: ['shopping'] },
    });
    expect(withFeature.items.map((i) => i.keyword)).toEqual(['купи обувки онлайн']);
  });

  it('stores SERP snapshots and returns the latest one and top URLs', async () => {
    const snap = (checkedAt: string, urls: string[]): SerpSnapshot => ({
      keyword: 'seo',
      locationCode: loc.locationCode,
      languageCode: loc.languageCode,
      device: 'desktop',
      depth: 10,
      checkedAt,
      totalResults: 1000,
      features: ['people_also_ask'],
      items: urls.map((url, i) => ({
        rankAbsolute: i + 1,
        rankGroup: i + 1,
        type: 'organic' as const,
        url,
        domain: new URL(url).hostname,
        title: `t${i}`,
        description: null,
      })),
    });
    const now = Date.now();
    await insertSerpSnapshot(ch, snap(new Date(now - 3600_000).toISOString(), ['https://old.bg/']));
    await insertSerpSnapshot(
      ch,
      snap(new Date(now).toISOString(), ['https://a.bg/', 'https://b.bg/']),
    );

    const latest = await latestSerp(ch, 'seo', loc, 'desktop', 24);
    expect(latest?.items.map((i) => i.url)).toEqual(['https://a.bg/', 'https://b.bg/']);
    expect(latest?.features).toEqual(['people_also_ask']);
    expect(await latestSerp(ch, 'seo', loc, 'mobile', 24)).toBeNull();

    const top = await latestTopUrls(ch, ['seo', 'other'], loc, 30);
    expect(top.get('seo')).toEqual(['https://a.bg/', 'https://b.bg/']);
    expect(top.has('other')).toBe(false);
  });
});
