/**
 * Organic competitor discovery.
 *
 * For every keyword the project ranks for in the top 20, count how often each other
 * domain also appears in that keyword's top 20. Then
 *   competition_level = common / (domain_keywords + project_keywords − common)
 * (Jaccard similarity of the two keyword sets). Universal domains (wikipedia,
 * youtube, …) rank for everything and are excluded.
 */

export const DEFAULT_UNIVERSAL_DOMAINS = [
  'wikipedia.org',
  'youtube.com',
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'reddit.com',
  'pinterest.com',
  'tiktok.com',
  'amazon.com',
  'quora.com',
  'google.com',
  'apple.com',
  'microsoft.com',
];

export interface KeywordSerpDomains {
  keyword: string;
  /** Domains in the keyword's top 20 (any order, duplicates allowed). */
  domains: readonly string[];
}

export interface CompetitorScore {
  domain: string;
  commonKeywords: number;
  domainKeywords: number;
  projectKeywords: number;
  competitionLevel: number;
}

export interface DiscoverOptions {
  universalDomains?: readonly string[];
  /** Total keywords each domain ranks for (from the provider); falls back to `commonKeywords`. */
  domainKeywordCounts?: ReadonlyMap<string, number>;
  /** Ignore domains sharing fewer keywords than this. */
  minCommon?: number;
  limit?: number;
}

/** Strip `www.` and match subdomains of universal domains (e.g. bg.wikipedia.org). */
function isUniversal(domain: string, universal: ReadonlySet<string>): boolean {
  const d = domain.replace(/^www\./, '');
  if (universal.has(d)) return true;
  for (const u of universal) if (d.endsWith(`.${u}`)) return true;
  return false;
}

export function discoverCompetitors(
  projectDomain: string,
  serps: readonly KeywordSerpDomains[],
  opts: DiscoverOptions = {},
): CompetitorScore[] {
  const universal = new Set(opts.universalDomains ?? DEFAULT_UNIVERSAL_DOMAINS);
  const self = projectDomain.replace(/^www\./, '');
  const projectKeywords = new Set(serps.map((s) => s.keyword)).size;
  const common = new Map<string, number>();

  for (const serp of serps) {
    // Count each domain once per keyword.
    for (const raw of new Set(serp.domains.map((d) => d.replace(/^www\./, '')))) {
      if (!raw || raw === self || raw.endsWith(`.${self}`) || isUniversal(raw, universal)) continue;
      common.set(raw, (common.get(raw) ?? 0) + 1);
    }
  }

  const minCommon = opts.minCommon ?? 1;
  const scores: CompetitorScore[] = [];
  for (const [domain, c] of common) {
    if (c < minCommon) continue;
    const domainKeywords = Math.max(c, opts.domainKeywordCounts?.get(domain) ?? c);
    const union = domainKeywords + projectKeywords - c;
    scores.push({
      domain,
      commonKeywords: c,
      domainKeywords,
      projectKeywords,
      competitionLevel: union > 0 ? c / union : 0,
    });
  }
  scores.sort(
    (a, b) =>
      b.competitionLevel - a.competitionLevel ||
      b.commonKeywords - a.commonKeywords ||
      a.domain.localeCompare(b.domain),
  );
  return opts.limit ? scores.slice(0, opts.limit) : scores;
}
