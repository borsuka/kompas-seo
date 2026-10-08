import { describe, expect, it } from 'vitest';
import { discoverCompetitors } from './competitors.js';
import { contentGap } from './content-gap.js';
import { countGapCategories, keywordGap, type DomainRanking } from './gap.js';

const r = (keyword: string, position: number): DomainRanking => ({ keyword, position });

describe('keywordGap', () => {
  const rankings = new Map<string, DomainRanking[]>([
    [
      'me.bg',
      [
        r('shared-strong', 1),
        r('shared-weak', 9),
        r('weak-partial', 20),
        r('unique', 4),
        r('mixed', 5),
      ],
    ],
    [
      'a.bg',
      [
        r('shared-strong', 3),
        r('shared-weak', 2),
        r('weak-partial', 5),
        r('missing', 7),
        r('untapped', 3),
        r('mixed', 2),
      ],
    ],
    ['b.bg', [r('shared-strong', 4), r('shared-weak', 1), r('missing', 9), r('mixed', 8)]],
    ['c.bg', [r('shared-strong', 6), r('shared-weak', 5), r('missing', 1), r('mixed', 9)]],
  ]);
  const rows = keywordGap('me.bg', ['a.bg', 'b.bg', 'c.bg'], rankings);
  const cat = (k: string) => rows.find((x) => x.keyword === k)!.categories.sort();

  it('assigns every category correctly', () => {
    expect(cat('missing')).toEqual(['missing']);
    expect(cat('untapped')).toEqual(['untapped']);
    expect(cat('unique')).toEqual(['unique']);
    expect(cat('shared-strong')).toEqual(['shared', 'strong']);
    expect(cat('shared-weak')).toEqual(['shared', 'weak']);
    expect(cat('weak-partial')).toEqual(['weak']);
    // ranks between competitors: shared, neither weak nor strong
    expect(cat('mixed')).toEqual(['shared']);
  });

  it('reports positions per domain and counts', () => {
    expect(rows.find((x) => x.keyword === 'missing')!.positions).toEqual({
      'me.bg': null,
      'a.bg': 7,
      'b.bg': 9,
      'c.bg': 1,
    });
    expect(countGapCategories(rows)).toEqual({
      missing: 1,
      weak: 2,
      strong: 1,
      untapped: 1,
      unique: 1,
      shared: 3,
    });
  });

  it('limits to 5 domains and needs a competitor', () => {
    expect(() => keywordGap('me', [], new Map())).toThrow();
    expect(() => keywordGap('me', ['a', 'b', 'c', 'd', 'e'], new Map())).toThrow(/up to 5/);
  });
});

describe('discoverCompetitors', () => {
  it('ranks by competition level and excludes self, subdomains and universal domains', () => {
    const serps = [
      { keyword: 'k1', domains: ['me.bg', 'rival.bg', 'bg.wikipedia.org', 'other.bg'] },
      { keyword: 'k2', domains: ['www.rival.bg', 'youtube.com', 'blog.me.bg'] },
      { keyword: 'k3', domains: ['rival.bg', 'rival.bg', 'big.bg'] },
      { keyword: 'k4', domains: ['big.bg'] },
    ];
    const res = discoverCompetitors('me.bg', serps, {
      domainKeywordCounts: new Map([['big.bg', 1000]]),
    });
    expect(res.map((c) => c.domain)).toEqual(['rival.bg', 'other.bg', 'big.bg']);
    expect(res[0]).toMatchObject({ commonKeywords: 3, domainKeywords: 3, projectKeywords: 4 });
    expect(res[0]!.competitionLevel).toBeCloseTo(3 / (3 + 4 - 3));
    // big.bg shares 2 keywords but ranks for 1000 → low level
    expect(res[2]!.competitionLevel).toBeCloseTo(2 / (1000 + 4 - 2));
  });
});

describe('contentGap', () => {
  it('finds competitor topics without a target page, grouped across competitors', () => {
    const pages = [
      {
        domain: 'a.bg',
        url: 'https://a.bg/zimni-gumi',
        traffic: 300,
        keywords: [
          { keyword: 'зимни гуми', volume: 5000, position: 2 },
          { keyword: 'гуми цена', volume: 900, position: 5 },
        ],
      },
      {
        domain: 'b.bg',
        url: 'https://b.bg/gumi',
        traffic: 100,
        keywords: [{ keyword: 'зимни гуми', volume: 5000, position: 6 }],
      },
      {
        domain: 'a.bg',
        url: 'https://a.bg/dzhanti',
        traffic: 50,
        keywords: [{ keyword: 'джанти', volume: 800, position: 3 }],
      },
      {
        domain: 'b.bg',
        url: 'https://b.bg/masla',
        traffic: 80,
        keywords: [{ keyword: 'моторни масла', volume: 700, position: 4 }],
      },
    ];
    const topics = contentGap(new Set(['моторни масла']), pages);
    expect(topics.map((t) => t.topic)).toEqual(['зимни гуми', 'джанти']);
    expect(topics[0]).toMatchObject({
      competitors: 2,
      keywords: 2,
      totalVolume: 5900,
      totalTraffic: 400,
    });
    expect(topics[0]!.pages[0]!.url).toBe('https://a.bg/zimni-gumi');
    expect(contentGap(new Set(), pages, { minCompetitors: 2 }).map((t) => t.topic)).toEqual([
      'зимни гуми',
    ]);
  });
});
