import { describe, expect, it, vi } from 'vitest';
import { domainKeywordSchema, domainOverviewSchema } from '@seo/shared';
import { MockProvider } from '../mock/mock-provider.js';
import { DataForSeoClient } from './client.js';
import { DataForSeoDomainProvider } from './dataforseo-domains.js';

const loc = { locationCode: 2100, languageCode: 'bg' } as const;
const now = () => new Date('2026-10-08T00:00:00Z');

const ok = (result: unknown[]) => ({
  status_code: 20000,
  status_message: 'Ok.',
  cost: 0.01,
  tasks: [{ id: 't', status_code: 20000, status_message: 'Ok.', cost: 0.01, result }],
});

function fakeFetch(handler: (path: string, body: Record<string, unknown>) => unknown) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.split('/v3/')[1]!;
    const body = (JSON.parse(String(init.body)) as Record<string, unknown>[])[0]!;
    calls.push({ path, body });
    return new Response(JSON.stringify(ok([handler(path, body)])), { status: 200 });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe('DataForSeoDomainProvider', () => {
  it('maps ranked keywords (live and lost) to DomainKeyword', async () => {
    const { fn, calls } = fakeFetch(() => ({
      items: [
        {
          keyword_data: {
            keyword: 'Зимни гуми',
            keyword_info: { search_volume: 5400, cpc: 0.8 },
            search_intent_info: { main_intent: 'commercial' },
          },
          ranked_serp_element: {
            serp_item: {
              type: 'organic',
              rank_group: 3,
              url: 'https://shop.bg/gumi',
              etv: 540.5,
              rank_changes: { previous_rank_absolute: 5, is_new: false },
            },
          },
        },
        {
          keyword_data: { keyword: 'летни гуми', keyword_info: { search_volume: 900 } },
          ranked_serp_element: {
            serp_item: {
              type: 'organic',
              rank_group: 12,
              url: 'https://shop.bg/letni',
              etv: 4,
              rank_changes: { is_new: true },
            },
          },
        },
      ],
    }));
    const p = new DataForSeoDomainProvider(
      new DataForSeoClient({ login: 'a', password: 'b', fetch: fn }),
      now,
    );
    const rows = await p.getDomainKeywords('https://www.shop.bg', loc, {
      limit: 50,
      offset: 0,
      mode: 'lost',
    });
    for (const r of rows) domainKeywordSchema.parse(r);
    expect(rows[0]).toMatchObject({
      domain: 'shop.bg',
      keyword: 'зимни гуми',
      position: 3,
      previousPosition: 5,
      estTraffic: 540.5,
      intent: ['commercial'],
    });
    expect(rows[1]!.previousPosition).toBeNull();
    expect(calls[0]).toMatchObject({
      path: 'dataforseo_labs/google/ranked_keywords/live',
      body: { target: 'shop.bg', historical_serp_mode: 'lost', limit: 50, item_types: ['organic'] },
    });
  });

  it('builds the overview from rank overview (all locations) and history', async () => {
    const { fn, calls } = fakeFetch((path) =>
      path.includes('domain_rank_overview')
        ? {
            items: [
              {
                location_code: 2100,
                language_code: 'bg',
                metrics: {
                  organic: {
                    pos_1: 10,
                    pos_2_3: 20,
                    pos_4_10: 70,
                    count: 1000,
                    etv: 4321.7,
                    is_new: 40,
                    is_lost: 25,
                  },
                },
              },
              {
                location_code: 2100,
                language_code: 'en',
                metrics: { organic: { count: 50, etv: 10 } },
              },
              {
                location_code: 2826,
                language_code: 'en',
                metrics: { organic: { count: 30, etv: 99 } },
              },
            ],
          }
        : {
            items: [
              { year: 2026, month: 9, metrics: { organic: { count: 990, etv: 4000 } } },
              { year: 2026, month: 8, metrics: { organic: { count: 900, etv: 3500 } } },
            ],
          },
    );
    const p = new DataForSeoDomainProvider(
      new DataForSeoClient({ login: 'a', password: 'b', fetch: fn }),
      now,
    );
    const o = domainOverviewSchema.parse(await p.getDomainOverview('shop.bg', loc));
    expect(o).toMatchObject({
      organicKeywords: 1000,
      top3: 30,
      top10: 100,
      top100: 1000,
      estTraffic: 4321.7,
      newKeywords: 40,
      lostKeywords: 25,
    });
    expect(o.history.map((h) => h.month)).toEqual([8, 9]);
    expect(o.countries).toEqual([
      { locationCode: 2100, keywords: 1050, estTraffic: 4332 },
      { locationCode: 2826, keywords: 30, estTraffic: 99 },
    ]);
    expect(calls.find((c) => c.path.includes('historical'))!.body).toMatchObject({
      target: 'shop.bg',
      location_code: 2100,
      date_from: '2025-10-08',
    });
  });

  it('maps competitors', async () => {
    const { fn } = fakeFetch(() => ({
      items: [
        { domain: 'shop.bg', intersections: 999 },
        {
          domain: 'www.rival.bg',
          avg_position: 7.5,
          intersections: 120,
          full_domain_metrics: { organic: { count: 800, etv: 3000 } },
        },
      ],
    }));
    const p = new DataForSeoDomainProvider(
      new DataForSeoClient({ login: 'a', password: 'b', fetch: fn }),
      now,
    );
    expect(await p.getCompetitors('shop.bg', loc)).toEqual([
      {
        domain: 'rival.bg',
        commonKeywords: 120,
        domainKeywords: 800,
        targetKeywords: 0,
        avgPosition: 7.5,
        estTraffic: 3000,
      },
    ]);
  });
});

describe('MockProvider domain overview', () => {
  const p = new MockProvider({ now });
  it('returns consistent totals, history and lost keywords', async () => {
    const o = domainOverviewSchema.parse(await p.getDomainOverview('example.bg', loc));
    expect(o.top3).toBeLessThanOrEqual(o.top10);
    expect(o.top10).toBeLessThanOrEqual(o.top100);
    expect(o.history).toHaveLength(12);
    expect(o.countries[0]!.locationCode).toBe(2100);
    const lost = await p.getDomainKeywords('example.bg', loc, {
      limit: 1000,
      offset: 0,
      mode: 'lost',
    });
    expect(lost.length).toBe(o.lostKeywords);
    const live = new Set(
      (await p.getDomainKeywords('example.bg', loc, { limit: 5000, offset: 0 })).map(
        (k) => k.keyword,
      ),
    );
    expect(lost.some((k) => live.has(k.keyword))).toBe(false);
  });
});
