import type {
  Backlink,
  BacklinkQuery,
  BacklinkSummary,
  CompetitorCandidate,
  Device,
  DomainKeyword,
  DomainKeywordQuery,
  DomainOverview,
  IdeaOptions,
  KeywordIdea,
  KeywordMetrics,
  Locale,
  Paging,
  ProviderOperation,
  ReferringDomain,
  SerpSnapshot,
} from '@seo/shared';

/**
 * The only way the application obtains third-party SEO data.
 * Implementations: MockProvider (default), DataForSeoProvider, GscProvider.
 */

export interface KeywordDataProvider {
  readonly name: string;
  getKeywordMetrics(keywords: string[], loc: Locale): Promise<KeywordMetrics[]>;
  getKeywordIdeas(seed: string, loc: Locale, opts: IdeaOptions): Promise<KeywordIdea[]>;
}

export interface SerpProvider {
  readonly name: string;
  getSerp(keyword: string, loc: Locale, device: Device, depth: number): Promise<SerpSnapshot>;
}

export interface DomainDataProvider {
  readonly name: string;
  getDomainKeywords(
    domain: string,
    loc: Locale,
    opts: DomainKeywordQuery,
  ): Promise<DomainKeyword[]>;
  getCompetitors(domain: string, loc: Locale): Promise<CompetitorCandidate[]>;
  /** Totals, position buckets, monthly history and country split (extension of the spec interface). */
  getDomainOverview(domain: string, loc: Locale): Promise<DomainOverview>;
}

export interface BacklinkProvider {
  readonly name: string;
  getBacklinkSummary(target: string): Promise<BacklinkSummary>;
  getBacklinks(target: string, opts: BacklinkQuery): Promise<Backlink[]>;
  getReferringDomains(target: string, opts: Paging): Promise<ReferringDomain[]>;
}

export interface ProviderSet {
  keywords: KeywordDataProvider;
  serp: SerpProvider;
  domains: DomainDataProvider;
  backlinks: BacklinkProvider;
}

export type ProviderKind = keyof ProviderSet;

const DAY = 86_400;

/** Cache TTL (seconds) per data type, as required by the spec. */
export const CACHE_TTL = {
  keyword: 30 * DAY,
  serp: 1 * DAY,
  backlink: 7 * DAY,
  domain: 7 * DAY,
} as const;

export interface MethodSpec {
  operation: ProviderOperation;
  ttlSec: number;
  /** Billing units for the credit cost formula. */
  units: (args: readonly unknown[]) => number;
}

/** Metadata for every provider method: credit operation, cache TTL and billing units. */
export const METHOD_SPECS = {
  keywords: {
    getKeywordMetrics: {
      operation: 'keyword.metrics',
      ttlSec: CACHE_TTL.keyword,
      units: (a) => (a[0] as string[]).length,
    },
    getKeywordIdeas: { operation: 'keyword.ideas', ttlSec: CACHE_TTL.keyword, units: () => 1 },
  },
  serp: {
    getSerp: { operation: 'serp.get', ttlSec: CACHE_TTL.serp, units: (a) => a[3] as number },
  },
  domains: {
    getDomainKeywords: {
      operation: 'domain.keywords',
      ttlSec: CACHE_TTL.domain,
      units: (a) => (a[2] as Paging).limit ?? 100,
    },
    getCompetitors: { operation: 'domain.competitors', ttlSec: CACHE_TTL.domain, units: () => 1 },
    getDomainOverview: { operation: 'domain.overview', ttlSec: CACHE_TTL.domain, units: () => 1 },
  },
  backlinks: {
    getBacklinkSummary: {
      operation: 'backlink.summary',
      ttlSec: CACHE_TTL.backlink,
      units: () => 1,
    },
    getBacklinks: {
      operation: 'backlink.list',
      ttlSec: CACHE_TTL.backlink,
      units: (a) => (a[1] as BacklinkQuery).limit,
    },
    getReferringDomains: {
      operation: 'backlink.referringDomains',
      ttlSec: CACHE_TTL.backlink,
      units: (a) => (a[1] as Paging).limit,
    },
  },
} as const satisfies { [K in ProviderKind]: Record<string, MethodSpec> };

export type MethodName<K extends ProviderKind> = keyof (typeof METHOD_SPECS)[K] & string;
