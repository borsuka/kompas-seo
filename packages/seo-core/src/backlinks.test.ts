import { describe, expect, it } from 'vitest';
import {
  anchorDistribution,
  classifyAnchor,
  disavowFile,
  linkGap,
  referringDomainsByMonth,
  toxicity,
  type LinkingDomain,
} from './backlinks.js';

const rd = (domain: string, extra: Partial<LinkingDomain> = {}): LinkingDomain => ({
  domain,
  rating: 40,
  backlinks: 3,
  dofollow: 3,
  spamScore: 2,
  ...extra,
});

describe('classifyAnchor', () => {
  it('recognizes branded, URL, generic and empty anchors in BG and EN', () => {
    expect(classifyAnchor('Moyat Zabolekar', 'moyat-zabolekar.bg')).toBe('branded');
    expect(classifyAnchor('moyatzabolekar', 'moyat-zabolekar.bg')).toBe('branded');
    expect(classifyAnchor('https://moyat-zabolekar.bg/', 'moyat-zabolekar.bg')).toBe('url');
    expect(classifyAnchor('www.example.com', 'moyat-zabolekar.bg')).toBe('url');
    expect(classifyAnchor('Прочети още', 'moyat-zabolekar.bg')).toBe('generic');
    expect(classifyAnchor('click here', 'moyat-zabolekar.bg')).toBe('generic');
    expect(classifyAnchor('  ', 'moyat-zabolekar.bg')).toBe('empty');
    expect(classifyAnchor('избелване на зъби', 'moyat-zabolekar.bg')).toBe('other');
  });

  it('groups anchors case-insensitively and counts referring domains', () => {
    const rows = anchorDistribution(
      [
        { anchor: 'Зъболекар', sourceDomain: 'a.bg', rel: 'follow' },
        { anchor: 'зъболекар', sourceDomain: 'b.bg', rel: 'nofollow' },
        { anchor: 'зъболекар', sourceDomain: 'b.bg', rel: 'follow' },
        { anchor: 'тук', sourceDomain: 'c.bg', rel: 'follow' },
      ],
      'clinic.bg',
    );
    expect(rows[0]).toMatchObject({
      anchor: 'Зъболекар',
      backlinks: 3,
      referringDomains: 2,
      dofollow: 2,
      type: 'other',
    });
    expect(rows[1]).toMatchObject({ anchor: 'тук', type: 'generic' });
  });
});

describe('linkGap', () => {
  it('lists live domains linking to competitors but not to the target', () => {
    const referring = new Map([
      ['me.bg', [rd('shared.bg'), rd('lost-for-me.bg', { lostAt: '2026-01-01' })]],
      [
        'a.bg',
        [
          rd('shared.bg'),
          rd('both.bg', { rating: 70, backlinks: 5 }),
          rd('only-a.bg'),
          rd('lost-for-me.bg'),
        ],
      ],
      [
        'b.bg',
        [rd('both.bg', { rating: 60 }), rd('gone.bg', { lostAt: '2025-05-01' }), rd('me.bg')],
      ],
    ]);
    const gap = linkGap('me.bg', ['a.bg', 'b.bg'], referring);
    expect(gap.map((g) => g.domain)).toEqual(['both.bg', 'lost-for-me.bg', 'only-a.bg']);
    expect(gap[0]).toMatchObject({
      competitors: 2,
      rating: 70,
      links: { 'me.bg': 0, 'a.bg': 5, 'b.bg': 3 },
    });
    expect(
      linkGap('me.bg', ['a.bg', 'b.bg'], referring, { minCompetitors: 2 }).map((g) => g.domain),
    ).toEqual(['both.bg']);
  });
});

describe('toxicity', () => {
  it('keeps normal domains low and flags spam signals', () => {
    expect(toxicity(rd('novini.bg'))).toMatchObject({ level: 'low', reasons: [] });
    const spam = toxicity(
      rd('casino-bonus-12.xyz', { rating: 1, spamScore: 80, dofollow: 0, backlinks: 400 }),
    );
    expect(spam.level).toBe('high');
    expect(spam.reasons).toEqual(
      expect.arrayContaining([
        'provider_spam_score',
        'spammy_tld',
        'spammy_words',
        'no_authority',
        'link_farm',
        'all_nofollow',
      ]),
    );
    expect(spam.score).toBeLessThanOrEqual(100);
    expect(toxicity(rd('1.2.3.4', { spamScore: null })).reasons).toContain('ip_address');
  });

  it('never scores below the provider spam score', () => {
    expect(toxicity(rd('normal.bg', { spamScore: 65 })).score).toBeGreaterThanOrEqual(65);
  });
});

describe('disavowFile', () => {
  it('writes Google disavow format with domains first, comments and no duplicates', () => {
    const file = disavowFile(
      [
        { type: 'url', value: 'https://spam.xyz/page' },
        { type: 'domain', value: 'WWW.Casino.xyz', reason: 'Spam\nsite' },
        { type: 'domain', value: 'casino.xyz' },
      ],
      'Kompas SEO\nme.bg',
    );
    expect(file).toBe(
      '# Kompas SEO\n# me.bg\n# Spam site\ndomain:casino.xyz\nhttps://spam.xyz/page\n',
    );
  });
});

describe('referringDomainsByMonth', () => {
  it('counts new and lost referring domains per month', () => {
    const rows = referringDomainsByMonth(
      [
        { firstSeen: '2026-10-02T00:00:00Z', lostAt: null },
        { firstSeen: '2026-09-15T00:00:00Z', lostAt: '2026-10-05T00:00:00Z' },
        { firstSeen: '2020-01-01T00:00:00Z', lostAt: null },
      ],
      3,
      new Date('2026-10-08T00:00:00Z'),
    );
    expect(rows).toEqual([
      { month: '2026-08', new: 0, lost: 0 },
      { month: '2026-09', new: 1, lost: 0 },
      { month: '2026-10', new: 1, lost: 1 },
    ]);
  });
});
