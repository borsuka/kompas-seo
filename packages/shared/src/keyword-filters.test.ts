import { describe, expect, it } from 'vitest';
import {
  compareKeywords,
  matchesKeywordFilters,
  type FilterableKeyword,
} from './keyword-filters.js';
import { keywordFiltersSchema } from './schemas/keywords.js';

const row = (keyword: string, extra: Partial<FilterableKeyword> = {}): FilterableKeyword => ({
  keyword,
  volume: 100,
  kd: 20,
  cpc: 1,
  competition: 0.5,
  wordCount: keyword.split(' ').length,
  intent: ['informational'],
  serpFeatures: [],
  ...extra,
});

describe('keyword filters', () => {
  it('parses query-string style input', () => {
    const f = keywordFiltersSchema.parse({
      minVolume: '50',
      intents: 'commercial,transactional',
      include: 'обувки',
    });
    expect(f).toMatchObject({
      minVolume: 50,
      intents: ['commercial', 'transactional'],
      include: ['обувки'],
    });
  });

  it('applies ranges, intents, features and include/exclude terms (case-insensitive)', () => {
    const f = keywordFiltersSchema.parse({
      minVolume: 50,
      maxKd: 30,
      intents: 'transactional',
      features: 'shopping',
      include: 'ОБУВКИ',
      exclude: 'дамски',
    });
    expect(
      matchesKeywordFilters(
        row('купи обувки', { intent: ['transactional'], serpFeatures: ['shopping'] }),
        f,
      ),
    ).toBe(true);
    expect(
      matchesKeywordFilters(
        row('купи дамски обувки', { intent: ['transactional'], serpFeatures: ['shopping'] }),
        f,
      ),
    ).toBe(false);
    expect(
      matchesKeywordFilters(row('купи обувки', { intent: ['transactional'], serpFeatures: [] }), f),
    ).toBe(false);
    expect(
      matchesKeywordFilters(
        row('купи обувки', { kd: null, intent: ['transactional'], serpFeatures: ['shopping'] }),
        f,
      ),
    ).toBe(false);
    expect(matchesKeywordFilters(row('x'), keywordFiltersSchema.parse({}))).toBe(true);
  });

  it('sorts with nulls last and a stable tiebreaker', () => {
    const rows = [row('б', { kd: null }), row('а', { kd: 10 }), row('в', { kd: 50 })];
    expect([...rows].sort(compareKeywords('kd', 'desc')).map((r) => r.keyword)).toEqual([
      'в',
      'а',
      'б',
    ]);
    expect([...rows].sort(compareKeywords('kd', 'asc')).map((r) => r.keyword)).toEqual([
      'а',
      'в',
      'б',
    ]);
    expect([...rows].sort(compareKeywords('keyword', 'asc')).map((r) => r.keyword)).toEqual([
      'а',
      'б',
      'в',
    ]);
  });
});
