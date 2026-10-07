import { describe, expect, it, vi } from 'vitest';
import {
  AppError,
  DEFAULT_CREDIT_COSTS,
  keywordMetricsSchema,
  serpSnapshotSchema,
} from '@seo/shared';
import { decorateProvider } from '../decorate.js';
import { ProviderError } from '../errors.js';
import { withUsageRecording } from '../middleware/usage.js';
import { MemoryUsageSink } from '../usage.js';
import { DATAFORSEO_HOSTS, DataForSeoClient } from './client.js';
import { DataForSeoProvider } from './dataforseo-provider.js';

const loc = { locationCode: 2100, languageCode: 'bg' } as const;
const now = () => new Date('2026-10-07T00:00:00Z');

function envelope(
  result: unknown[],
  opts: { status?: number; taskStatus?: number; cost?: number } = {},
) {
  return {
    status_code: opts.status ?? 20000,
    status_message: 'Ok.',
    cost: opts.cost ?? 0.01,
    tasks: [
      {
        id: 't1',
        status_code: opts.taskStatus ?? 20000,
        status_message: 'Ok.',
        cost: opts.cost ?? 0.01,
        result,
      },
    ],
  };
}

function fakeFetch(...responses: unknown[]) {
  const calls: { url: string; body: unknown; auth: string }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({
      url,
      body: JSON.parse(String(init.body)),
      auth: (init.headers as Record<string, string>).Authorization!,
    });
    const next = responses.length > 1 ? responses.shift() : responses[0];
    return new Response(JSON.stringify(next), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const labsItem = {
  keyword: 'SEO Оптимизация',
  keyword_info: {
    search_volume: 1900,
    cpc: 1.25,
    competition: 0.42,
    competition_level: 'MEDIUM',
    monthly_searches: [
      { year: 2026, month: 9, search_volume: 2000 },
      { year: 2026, month: 8, search_volume: 1800 },
    ],
  },
  keyword_properties: { keyword_difficulty: 37 },
  serp_info: {
    serp_item_types: ['organic', 'people_also_ask', 'paid', 'ai_overview', 'unknown_widget'],
  },
  search_intent_info: { main_intent: 'commercial', foreign_intent: ['informational', 'bogus'] },
};

describe('DataForSeoClient', () => {
  it('uses Basic auth, posts one task and selects live or sandbox host', async () => {
    const { fn, calls } = fakeFetch(envelope([{ ok: 1 }]));
    const live = new DataForSeoClient({ login: 'me', password: 'secret', fetch: fn });
    await expect(live.post('x/y/live', { a: 1 })).resolves.toEqual([{ ok: 1 }]);
    expect(calls[0]!.url).toBe(`${DATAFORSEO_HOSTS.live}/v3/x/y/live`);
    expect(calls[0]!.body).toEqual([{ a: 1 }]);
    expect(calls[0]!.auth).toBe(`Basic ${Buffer.from('me:secret').toString('base64')}`);

    const sandbox = new DataForSeoClient({
      login: 'me',
      password: 'secret',
      sandbox: true,
      fetch: fn,
    });
    await sandbox.post('x', {});
    expect(calls[1]!.url.startsWith(DATAFORSEO_HOSTS.sandbox)).toBe(true);
  });

  it('requires credentials', () => {
    expect(() => new DataForSeoClient({ login: '', password: '' })).toThrow(AppError);
  });

  it('maps status codes to retriable / non-retriable errors', async () => {
    const run = async (opts: Parameters<typeof envelope>[1]) =>
      new DataForSeoClient({ login: 'a', password: 'b', fetch: fakeFetch(envelope([], opts)).fn })
        .post('x', {})
        .catch((e: unknown) => e);

    expect(await run({ taskStatus: 40102 })).toEqual([]);
    const rate = await run({ taskStatus: 40202 });
    expect(rate).toBeInstanceOf(ProviderError);
    expect((rate as ProviderError).retriable).toBe(true);
    const funds = await run({ taskStatus: 40210 });
    expect((funds as ProviderError).retriable).toBe(false);
    const auth = await run({ status: 40100 });
    expect((auth as AppError).code).toBe('PROVIDER_NOT_CONFIGURED');
  });

  it('treats HTTP 5xx as retriable', async () => {
    const fn = vi.fn(async () => new Response('oops', { status: 503 })) as unknown as typeof fetch;
    const err = await new DataForSeoClient({ login: 'a', password: 'b', fetch: fn })
      .post('x', {})
      .catch((e) => e);
    expect((err as ProviderError).retriable).toBe(true);
  });
});

describe('DataForSeoProvider', () => {
  it('maps Labs keyword_overview items to KeywordMetrics', async () => {
    const { fn, calls } = fakeFetch(envelope([{ items: [labsItem] }]));
    const p = new DataForSeoProvider(
      new DataForSeoClient({ login: 'a', password: 'b', fetch: fn }),
      now,
    );
    const [m] = await p.getKeywordMetrics(['seo оптимизация', 'SEO оптимизация'], loc);
    keywordMetricsSchema.parse(m);
    expect(m).toMatchObject({
      keyword: 'seo оптимизация',
      volume: 1900,
      cpc: 1.25,
      competition: 0.42,
      competitionLevel: 'medium',
      kd: 37,
      intent: ['commercial', 'informational'],
    });
    expect(m!.trend.map((t) => t.month)).toEqual([8, 9]);
    expect(m!.serpFeatures).toEqual(
      expect.arrayContaining(['people_also_ask', 'ai_overview', 'top_ads']),
    );
    expect(calls[0]!.url).toContain('dataforseo_labs/google/keyword_overview/live');
    expect(calls[0]!.body).toEqual([
      {
        keywords: ['seo оптимизация'],
        location_code: 2100,
        language_code: 'bg',
        include_serp_info: true,
      },
    ]);
  });

  it('collects ideas per source without duplicates', async () => {
    const related = {
      items: [{ keyword_data: { ...labsItem, keyword: 'seo услуги' } }, { keyword_data: labsItem }],
    };
    const { fn, calls } = fakeFetch(envelope([{ items: [labsItem] }]), envelope([related]));
    const p = new DataForSeoProvider(
      new DataForSeoClient({ login: 'a', password: 'b', fetch: fn }),
      now,
    );
    const ideas = await p.getKeywordIdeas('seo оптимизация', loc, {
      sources: ['matching', 'related'],
      limit: 50,
    });
    expect(ideas.map((i) => [i.keyword, i.source])).toEqual([
      ['seo оптимизация', 'matching'],
      ['seo услуги', 'related'],
    ]);
    expect(calls.map((c) => c.url.split('/v3/')[1])).toEqual([
      'dataforseo_labs/google/keyword_suggestions/live',
      'dataforseo_labs/google/related_keywords/live',
    ]);
  });

  it('maps SERP items, features and top vs bottom ads', async () => {
    const serp = {
      keyword: 'seo',
      datetime: '2026-10-07 10:00:00 +00:00',
      se_results_count: 12345,
      item_types: ['ai_overview', 'paid', 'organic', 'people_also_ask'],
      items: [
        {
          type: 'ai_overview',
          rank_group: 1,
          rank_absolute: 1,
          references: [{ url: 'https://a.bg/' }],
        },
        { type: 'paid', rank_group: 1, rank_absolute: 2, domain: 'ads.bg', url: 'https://ads.bg/' },
        {
          type: 'organic',
          rank_group: 1,
          rank_absolute: 3,
          domain: 'www.a.bg',
          url: 'https://www.a.bg/',
          title: 'A',
        },
        {
          type: 'people_also_ask',
          rank_group: 1,
          rank_absolute: 4,
          items: [{ title: 'какво е seo' }],
        },
        { type: 'organic', rank_group: 2, rank_absolute: 5, domain: 'b.bg', url: 'https://b.bg/x' },
        { type: 'perspectives', rank_group: 1, rank_absolute: 6 },
      ],
    };
    const { fn, calls } = fakeFetch(envelope([serp]));
    const p = new DataForSeoProvider(
      new DataForSeoClient({ login: 'a', password: 'b', fetch: fn }),
      now,
    );
    const snap = serpSnapshotSchema.parse(await p.getSerp('SEO', loc, 'mobile', 20));
    expect(snap.items.map((i) => i.type)).toEqual([
      'ai_overview',
      'paid',
      'organic',
      'people_also_ask',
      'organic',
    ]);
    expect(snap.items[2]!.domain).toBe('a.bg');
    expect(snap.items[3]!.extra).toEqual({ questions: ['какво е seo'] });
    expect(snap.features).toEqual(
      expect.arrayContaining(['ai_overview', 'people_also_ask', 'top_ads']),
    );
    expect(snap.checkedAt).toBe('2026-10-07T10:00:00.000Z');
    expect(calls[0]!.body).toEqual([
      { keyword: 'seo', location_code: 2100, language_code: 'bg', device: 'mobile', depth: 20 },
    ]);
  });

  it('reports the real request cost to provider_usage', async () => {
    const { fn } = fakeFetch(envelope([{ items: [labsItem] }], { cost: 0.0123 }));
    const sink = new MemoryUsageSink();
    const raw = new DataForSeoProvider(
      new DataForSeoClient({ login: 'a', password: 'b', fetch: fn }),
      now,
    );
    const p = decorateProvider('keywords', raw, [withUsageRecording(sink, DEFAULT_CREDIT_COSTS)]);
    await p.getKeywordMetrics(['seo'], loc);
    expect(sink.events[0]).toMatchObject({
      provider: 'dataforseo',
      costUsd: 0.0123,
      cached: false,
    });
  });
});
