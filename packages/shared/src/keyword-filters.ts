import type { KeywordFilters } from './schemas/keywords.js';

/** Minimal row shape the filters operate on (explorer rows, list items). */
export interface FilterableKeyword {
  keyword: string;
  volume: number;
  kd: number | null;
  cpc: number | null;
  competition: number | null;
  wordCount: number;
  intent: readonly string[];
  serpFeatures: readonly string[];
}

const inRange = (v: number | null, min?: number, max?: number) => {
  if (min === undefined && max === undefined) return true;
  if (v === null) return false;
  return (min === undefined || v >= min) && (max === undefined || v <= max);
};

/** Same semantics as the ClickHouse explorer filters (server-side, in memory). */
export function matchesKeywordFilters(row: FilterableKeyword, f: KeywordFilters): boolean {
  const kw = row.keyword.toLowerCase();
  return (
    inRange(row.volume, f.minVolume, f.maxVolume) &&
    inRange(row.kd, f.minKd, f.maxKd) &&
    inRange(row.cpc, f.minCpc, f.maxCpc) &&
    inRange(row.wordCount, f.minWords, f.maxWords) &&
    (!f.intents.length || f.intents.some((i) => row.intent.includes(i))) &&
    f.features.every((x) => row.serpFeatures.includes(x)) &&
    f.include.every((t) => kw.includes(t.toLowerCase())) &&
    !f.exclude.some((t) => kw.includes(t.toLowerCase()))
  );
}

export type SortableField = 'volume' | 'kd' | 'cpc' | 'competition' | 'wordCount' | 'keyword';

/** Nulls last in both directions, keyword as a stable tiebreaker. */
export function compareKeywords(field: SortableField, dir: 'asc' | 'desc') {
  const sign = dir === 'asc' ? 1 : -1;
  return (a: FilterableKeyword, b: FilterableKeyword): number => {
    if (field === 'keyword') return sign * a.keyword.localeCompare(b.keyword, 'bg');
    const x = a[field];
    const y = b[field];
    if (x === null && y === null) return a.keyword.localeCompare(b.keyword, 'bg');
    if (x === null) return 1;
    if (y === null) return -1;
    return sign * (x - y) || a.keyword.localeCompare(b.keyword, 'bg');
  };
}
