/**
 * Keyword gap between a target domain and up to 4 competitors (5 domains in total).
 *
 * Categories (a keyword can belong to several, e.g. shared + strong):
 * - missing:  every competitor ranks, the target does not
 * - weak:     the target ranks, but lower than every competitor that ranks
 * - strong:   the target ranks higher than every competitor that ranks
 * - untapped: the target does not rank, some (not all) competitors do
 * - unique:   only the target ranks
 * - shared:   every domain (target and all competitors) ranks
 */

export const GAP_CATEGORIES = [
  'missing',
  'weak',
  'strong',
  'untapped',
  'unique',
  'shared',
] as const;
export type GapCategory = (typeof GAP_CATEGORIES)[number];

export interface DomainRanking {
  keyword: string;
  position: number;
  url?: string;
}

export interface GapRow {
  keyword: string;
  /** Position per domain (null = not ranking within the provided data). */
  positions: Record<string, number | null>;
  categories: GapCategory[];
}

export const MAX_GAP_DOMAINS = 5;

export function keywordGap(
  target: string,
  competitors: readonly string[],
  rankings: ReadonlyMap<string, readonly DomainRanking[]>,
): GapRow[] {
  const comps = [...new Set(competitors.filter((c) => c !== target))];
  if (comps.length === 0) throw new Error('keywordGap needs at least one competitor');
  if (comps.length + 1 > MAX_GAP_DOMAINS) {
    throw new Error(`keywordGap supports up to ${MAX_GAP_DOMAINS} domains`);
  }
  const domains = [target, ...comps];

  // keyword → domain → best position
  const table = new Map<string, Map<string, number>>();
  for (const d of domains) {
    for (const r of rankings.get(d) ?? []) {
      if (!(r.position >= 1)) continue;
      const row = table.get(r.keyword) ?? new Map<string, number>();
      const prev = row.get(d);
      if (prev === undefined || r.position < prev) row.set(d, r.position);
      table.set(r.keyword, row);
    }
  }

  const out: GapRow[] = [];
  for (const [keyword, row] of table) {
    const own = row.get(target);
    const ranking = comps.filter((c) => row.has(c));
    const compPositions = ranking.map((c) => row.get(c)!);
    const categories: GapCategory[] = [];

    if (own === undefined) {
      if (ranking.length === comps.length) categories.push('missing');
      else if (ranking.length > 0) categories.push('untapped');
    } else if (ranking.length === 0) {
      categories.push('unique');
    } else {
      if (compPositions.every((p) => own > p)) categories.push('weak');
      if (compPositions.every((p) => own < p)) categories.push('strong');
      if (ranking.length === comps.length) categories.push('shared');
    }

    out.push({
      keyword,
      positions: Object.fromEntries(domains.map((d) => [d, row.get(d) ?? null])),
      categories,
    });
  }
  return out;
}

export function countGapCategories(rows: readonly GapRow[]): Record<GapCategory, number> {
  const counts = Object.fromEntries(GAP_CATEGORIES.map((c) => [c, 0])) as Record<
    GapCategory,
    number
  >;
  for (const r of rows) for (const c of r.categories) counts[c]++;
  return counts;
}
