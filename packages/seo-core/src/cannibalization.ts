/**
 * Keyword cannibalization: several pages of the same site competing for one query.
 * Input rows are Search Console data aggregated by query + page over a period.
 */

export interface QueryPageRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  /** Average position of the page for the query. */
  position: number;
}

export interface CannibalizationIssue {
  query: string;
  clicks: number;
  impressions: number;
  severity: 'high' | 'medium';
  pages: { page: string; clicks: number; impressions: number; position: number; share: number }[];
}

/**
 * A query is cannibalized when ≥ 2 pages each get at least `minShare` of its impressions.
 * High severity: the two strongest pages split the impressions (≥ 30 % each) and rank
 * close to each other (≤ 10 positions apart), so Google keeps swapping them.
 */
export function detectCannibalization(
  rows: readonly QueryPageRow[],
  opts: { minImpressions?: number; minShare?: number } = {},
): CannibalizationIssue[] {
  const minImpressions = opts.minImpressions ?? 20;
  const minShare = opts.minShare ?? 0.1;
  const byQuery = new Map<string, QueryPageRow[]>();
  for (const r of rows) byQuery.set(r.query, [...(byQuery.get(r.query) ?? []), r]);

  const issues: CannibalizationIssue[] = [];
  for (const [query, list] of byQuery) {
    const impressions = list.reduce((s, r) => s + r.impressions, 0);
    if (impressions < minImpressions) continue;
    const pages = list
      .map((r) => ({
        page: r.page,
        clicks: r.clicks,
        impressions: r.impressions,
        position: Math.round(r.position * 10) / 10,
        share: Math.round((r.impressions / impressions) * 1000) / 1000,
      }))
      .filter((p) => p.share >= minShare)
      .sort((a, b) => b.impressions - a.impressions || a.position - b.position);
    if (pages.length < 2) continue;
    const [a, b] = pages as [(typeof pages)[0], (typeof pages)[0]];
    const severity =
      a.share >= 0.3 && b.share >= 0.3 && Math.abs(a.position - b.position) <= 10
        ? 'high'
        : 'medium';
    issues.push({
      query,
      clicks: list.reduce((s, r) => s + r.clicks, 0),
      impressions,
      severity,
      pages,
    });
  }
  return issues.sort(
    (x, y) =>
      (x.severity === y.severity ? 0 : x.severity === 'high' ? -1 : 1) ||
      y.impressions - x.impressions,
  );
}
