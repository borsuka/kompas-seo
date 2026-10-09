import { describe, expect, it } from 'vitest';
import { detectCannibalization } from './cannibalization.js';
import { analyzeTopPages, normalizeHeading, type AnalyzedPage } from './content-analysis.js';
import { templateBrief } from './content-brief.js';

const page = (i: number, extra: Partial<AnalyzedPage> = {}): AnalyzedPage => ({
  url: `https://site${i}.bg/zabi`,
  position: i,
  title: i % 2 ? 'Избелване на зъби – цени' : 'Професионално избелване',
  metaDescription: 'Избелване на зъби в София на достъпни цени.',
  h1: ['Избелване на зъби'],
  headings: [
    { level: 2, text: '1. Цени на избелването' },
    { level: 2, text: 'Как протича процедурата?' },
    { level: 3, text: `Детайл ${i}` },
  ],
  text: 'Избелване на зъби с лазер. Домашно избелване с шини. Цената зависи от метода и чувствителност на зъбите.',
  wordCount: 800 + i * 100,
  images: 4,
  schemaTypes: i <= 3 ? ['FAQPage', 'Dentist'] : ['Article'],
  ...extra,
});

describe('analyzeTopPages', () => {
  const pages = Array.from({ length: 10 }, (_, i) => page(i + 1));
  const a = analyzeTopPages(pages, 'избелване на зъби');

  it('recommends a word count range from the middle of the top 10', () => {
    expect(a.pagesAnalyzed).toBe(10);
    expect(a.wordCount.median).toBe(1350);
    expect(a.wordCount.recommendedMin).toBeLessThanOrEqual(a.wordCount.median);
    expect(a.wordCount.recommendedMax).toBeGreaterThanOrEqual(a.wordCount.median);
  });

  it('finds common headings, terms and schema types', () => {
    expect(a.topics.map((t) => t.heading)).toEqual(
      expect.arrayContaining(['цени на избелването', 'как протича процедурата']),
    );
    expect(a.topics.find((t) => t.heading.startsWith('детайл'))).toBeUndefined();
    const terms = a.terms.map((t) => t.term);
    expect(terms).toEqual(expect.arrayContaining(['лазер', 'шини', 'домашно избелване']));
    // Keyword words alone and stopwords are not recommended.
    expect(terms).not.toContain('избелване');
    expect(terms).not.toContain('на');
    // Neither are phrases made only of the keyword's own words.
    expect(terms).not.toContain('избелване зъби');
    expect(a.terms[0]!.coverage).toBe(1);
    expect(a.schemaTypes[0]).toEqual({ type: 'Article', pages: 7 });
    expect(a.keywordInH1).toBe(1);
    expect(a.keywordInTitle).toBe(0.5);
    expect(a.headings).toEqual({ medianH2: 2, medianH3: 1 });
  });

  it('normalizes headings for grouping', () => {
    expect(normalizeHeading('  3) Цени на импланти: ')).toBe('цени на импланти');
    expect(normalizeHeading('What is SEO?')).toBe('what is seo');
  });

  it('handles no pages', () => {
    expect(analyzeTopPages([], 'x')).toMatchObject({ pagesAnalyzed: 0, terms: [], topics: [] });
  });
});

describe('detectCannibalization', () => {
  it('flags queries where several pages split impressions, high when they compete closely', () => {
    const issues = detectCannibalization([
      { query: 'избелване на зъби', page: '/a', clicks: 30, impressions: 500, position: 6 },
      { query: 'избелване на зъби', page: '/b', clicks: 20, impressions: 400, position: 9 },
      { query: 'импланти', page: '/c', clicks: 50, impressions: 900, position: 3 },
      { query: 'импланти', page: '/d', clicks: 1, impressions: 120, position: 40 },
      { query: 'импланти', page: '/e', clicks: 0, impressions: 5, position: 70 },
      { query: 'брекети', page: '/f', clicks: 10, impressions: 300, position: 5 },
      { query: 'рядка', page: '/g', clicks: 0, impressions: 5, position: 20 },
      { query: 'рядка', page: '/h', clicks: 0, impressions: 5, position: 22 },
    ]);
    expect(issues.map((i) => [i.query, i.severity])).toEqual([
      ['избелване на зъби', 'high'],
      ['импланти', 'medium'],
    ]);
    expect(issues[1]!.pages.map((p) => p.page)).toEqual(['/c', '/d']);
    expect(issues[0]!.pages[0]!.share).toBeCloseTo(0.556, 2);
  });
});

describe('templateBrief', () => {
  const pages = Array.from({ length: 10 }, (_, i) => page(i + 1));
  const analysis = analyzeTopPages(pages, 'избелване на зъби');

  it('builds a localized outline from shared topics, terms and questions', () => {
    const brief = templateBrief('избелване на зъби', analysis, {
      language: 'bg',
      intent: 'commercial',
      questions: ['Колко струва избелването?', 'Колко струва избелването?', 'Боли ли?'],
      year: 2026,
    });
    expect(brief.h1).toBe('Избелване на зъби');
    expect(brief.titleOptions[0]).toContain('2026');
    expect(brief.searchIntent).toBe('Търговско');
    expect(brief.outline[0]!.heading).toBe('Въведение');
    expect(brief.outline.map((o) => o.heading)).toEqual(
      expect.arrayContaining(['Цени на избелването', 'Често задавани въпроси', 'Боли ли?']),
    );
    expect(brief.questions).toEqual(['Колко струва избелването?', 'Боли ли?']);
    expect(brief.keyTerms).toContain('лазер');
    expect(brief.wordCount.min).toBeGreaterThan(0);
    expect(brief.metaDescription.length).toBeLessThanOrEqual(160);
    expect(templateBrief('teeth whitening', analysis, { language: 'en' }).outline[0]!.heading).toBe(
      'Introduction',
    );
  });
});
