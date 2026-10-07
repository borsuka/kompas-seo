import { describe, expect, it } from 'vitest';
import {
  backlinkSchema,
  backlinkSummarySchema,
  competitorCandidateSchema,
  domainKeywordSchema,
  keywordIdeaSchema,
  keywordMetricsSchema,
  referringDomainSchema,
  serpSnapshotSchema,
  type Locale,
} from '@seo/shared';
import { MockProvider } from './mock-provider.js';
import { createRng, hashString, slugify, toVolumeBucket } from './rng.js';

const BG: Locale = { locationCode: 2100, languageCode: 'bg' };
const US: Locale = { locationCode: 2840, languageCode: 'en' };
const now = () => new Date('2026-10-07T12:00:00Z');

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = createRng('seed');
    const b = createRng('seed');
    expect([a.next(), a.next(), a.int(1, 100)]).toEqual([b.next(), b.next(), b.int(1, 100)]);
    expect(createRng('other').next()).not.toBe(createRng('seed').next());
    expect(hashString('абв')).toBe(hashString('абв'));
  });

  it('maps to Google-like volume buckets and transliterates slugs', () => {
    expect(toVolumeBucket(1234)).toBe(1300);
    expect(toVolumeBucket(3)).toBe(0);
    expect(slugify('SEO Оптимизация София')).toBe('seo-optimizatsiya-sofiya');
  });
});

describe('MockProvider', () => {
  const p = new MockProvider({ now });

  it('returns identical data for identical input', async () => {
    const a = await new MockProvider({ now }).getKeywordIdeas('seo оптимизация', BG, {
      sources: ['matching', 'question'],
      limit: 50,
    });
    const b = await new MockProvider({ now }).getKeywordIdeas('seo оптимизация', BG, {
      sources: ['matching', 'question'],
      limit: 50,
    });
    expect(a).toEqual(b);
  });

  it('generates Bulgarian keyword ideas with every field', async () => {
    const ideas = await p.getKeywordIdeas('SEO оптимизация', BG, {
      sources: ['matching', 'related', 'question', 'autocomplete'],
      limit: 200,
    });
    expect(ideas.length).toBeGreaterThan(50);
    expect(ideas[0]!.keyword).toBe('seo оптимизация');
    for (const idea of ideas) expect(() => keywordIdeaSchema.parse(idea)).not.toThrow();
    expect(ideas.some((i) => i.source === 'question' && i.keyword.startsWith('какво е'))).toBe(
      true,
    );
    expect(ideas.some((i) => i.keyword.includes('цена'))).toBe(true);
    expect(new Set(ideas.map((i) => i.keyword)).size).toBe(ideas.length);
    for (const idea of ideas) expect(idea.trend).toHaveLength(24);
  });

  it('respects limit and requested sources', async () => {
    const ideas = await p.getKeywordIdeas('обувки', BG, { sources: ['question'], limit: 5 });
    expect(ideas).toHaveLength(5);
    expect(ideas.every((i) => i.source === 'question')).toBe(true);
  });

  it('assigns rule-based intent and plausible metrics', async () => {
    const [buy, info] = await p.getKeywordMetrics(['купи обувки', 'какво е seo'], BG);
    expect(buy!.intent).toContain('transactional');
    expect(info!.intent).toContain('informational');
    for (const m of [buy!, info!]) {
      keywordMetricsSchema.parse(m);
      expect(m.kd).toBeGreaterThanOrEqual(0);
      expect(m.kd).toBeLessThanOrEqual(100);
    }
  });

  it('has bigger volumes in bigger markets on average', async () => {
    const kws = ['seo', 'shoes', 'hotel', 'laptop', 'flowers', 'dentist', 'pizza', 'travel'];
    const sum = (ms: { volume: number }[]) => ms.reduce((s, m) => s + m.volume, 0);
    expect(sum(await p.getKeywordMetrics(kws, US))).toBeGreaterThan(
      sum(await p.getKeywordMetrics(kws, BG)),
    );
  });

  it('builds a SERP with organic results and features', async () => {
    const serp = await p.getSerp('seo оптимизация софия', BG, 'desktop', 100);
    serpSnapshotSchema.parse(serp);
    const organic = serp.items.filter((i) => i.type === 'organic');
    expect(organic).toHaveLength(100);
    expect(organic.map((o) => o.rankGroup)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(serp.items.map((i) => i.rankAbsolute)).toEqual(serp.items.map((_, i) => i + 1));
  });

  it('shares top-10 URLs between keywords of the same topic (clustering input)', async () => {
    const top10 = async (k: string) =>
      new Set(
        (await p.getSerp(k, BG, 'desktop', 10)).items
          .filter((i) => i.type === 'organic')
          .map((i) => i.url),
      );
    const a = await top10('seo оптимизация цена');
    const b = await top10('seo оптимизация цени');
    const c = await top10('обувки онлайн');
    const common = (x: Set<string | null>, y: Set<string | null>) =>
      [...x].filter((u) => y.has(u)).length;
    expect(common(a, b)).toBeGreaterThanOrEqual(3);
    expect(common(a, c)).toBe(0);
  });

  it('pages domain keywords consistently', async () => {
    const page1 = await p.getDomainKeywords('example.bg', BG, { limit: 20, offset: 0 });
    const page2 = await p.getDomainKeywords('example.bg', BG, { limit: 20, offset: 20 });
    const both = await p.getDomainKeywords('example.bg', BG, { limit: 40, offset: 0 });
    expect([...page1, ...page2]).toEqual(both);
    for (const row of both) domainKeywordSchema.parse(row);
    expect(both[0]!.estTraffic! >= both[1]!.estTraffic!).toBe(true);
  });

  it('returns competitors including universal domains', async () => {
    const competitors = await p.getCompetitors('example.bg', BG);
    expect(competitors.length).toBeGreaterThan(5);
    for (const c of competitors) competitorCandidateSchema.parse(c);
    expect(
      competitors.some((c) => c.domain === 'youtube.com' || c.domain === 'wikipedia.org'),
    ).toBe(true);
  });

  it('returns consistent backlink data', async () => {
    const summary = backlinkSummarySchema.parse(
      await p.getBacklinkSummary('https://www.example.bg/'),
    );
    expect(summary.target).toBe('example.bg');
    const live = await p.getBacklinks('example.bg', {
      limit: 50,
      offset: 0,
      status: 'live',
      onePerDomain: false,
    });
    expect(live.every((b) => b.lostAt === null)).toBe(true);
    for (const b of live) backlinkSchema.parse(b);
    const lost = await p.getBacklinks('example.bg', {
      limit: 50,
      offset: 0,
      status: 'lost',
      onePerDomain: false,
    });
    expect(lost.every((b) => b.lostAt !== null)).toBe(true);
    const perDomain = await p.getBacklinks('example.bg', {
      limit: 500,
      offset: 0,
      status: 'all',
      onePerDomain: true,
    });
    expect(new Set(perDomain.map((b) => b.sourceDomain)).size).toBe(perDomain.length);
    const domains = await p.getReferringDomains('example.bg', { limit: 10, offset: 0 });
    for (const d of domains) referringDomainSchema.parse(d);
    expect(domains[0]!.rating >= domains.at(-1)!.rating).toBe(true);
  });
});
