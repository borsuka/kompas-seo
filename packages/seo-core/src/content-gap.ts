/**
 * Content gap: topics competitors cover with dedicated pages that the target has no
 * page for. A page's topic is its highest-volume keyword; a topic is covered when the
 * target ranks for any keyword of that page.
 */

export interface PageKeyword {
  keyword: string;
  volume: number;
  position: number;
}

export interface CompetitorPage {
  domain: string;
  url: string;
  keywords: readonly PageKeyword[];
  /** Estimated monthly traffic of the page (optional, used for sorting). */
  traffic?: number;
}

export interface ContentGapTopic {
  topic: string;
  /** Competitor pages covering the topic (best first). */
  pages: { domain: string; url: string; traffic: number }[];
  /** Distinct keywords across those pages. */
  keywords: number;
  totalVolume: number;
  totalTraffic: number;
  competitors: number;
}

export function contentGap(
  targetKeywords: ReadonlySet<string>,
  pages: readonly CompetitorPage[],
  opts: { minCompetitors?: number; minPageKeywords?: number } = {},
): ContentGapTopic[] {
  const minPageKeywords = opts.minPageKeywords ?? 1;
  const groups = new Map<string, { pages: CompetitorPage[]; keywords: Map<string, number> }>();

  for (const page of pages) {
    if (page.keywords.length < minPageKeywords) continue;
    if (page.keywords.some((k) => targetKeywords.has(k.keyword))) continue;
    const topic = [...page.keywords].sort(
      (a, b) => b.volume - a.volume || a.keyword.localeCompare(b.keyword),
    )[0]!.keyword;
    const g = groups.get(topic) ?? { pages: [], keywords: new Map<string, number>() };
    g.pages.push(page);
    for (const k of page.keywords)
      g.keywords.set(k.keyword, Math.max(g.keywords.get(k.keyword) ?? 0, k.volume));
    groups.set(topic, g);
  }

  const minCompetitors = opts.minCompetitors ?? 1;
  const topics: ContentGapTopic[] = [];
  for (const [topic, g] of groups) {
    const competitors = new Set(g.pages.map((p) => p.domain)).size;
    if (competitors < minCompetitors) continue;
    const sorted = [...g.pages].sort((a, b) => (b.traffic ?? 0) - (a.traffic ?? 0));
    topics.push({
      topic,
      pages: sorted.map((p) => ({
        domain: p.domain,
        url: p.url,
        traffic: Math.round(p.traffic ?? 0),
      })),
      keywords: g.keywords.size,
      totalVolume: [...g.keywords.values()].reduce((s, v) => s + v, 0),
      totalTraffic: Math.round(sorted.reduce((s, p) => s + (p.traffic ?? 0), 0)),
      competitors,
    });
  }
  topics.sort(
    (a, b) =>
      b.competitors - a.competitors ||
      b.totalTraffic - a.totalTraffic ||
      b.totalVolume - a.totalVolume,
  );
  return topics;
}
