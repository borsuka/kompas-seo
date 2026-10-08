import {
  normalizeDomain,
  type CompetitorCandidate,
  type DomainKeyword,
  type DomainKeywordQuery,
  type DomainOverview,
  type Locale,
} from '@seo/shared';
import type { DomainDataProvider } from '../types.js';
import type { DataForSeoClient } from './client.js';
import { mapLabsKeyword, type RawLabsKeyword } from './dataforseo-provider.js';

/** DataForSEO "metrics.organic" block (shared by several Labs endpoints). */
interface RawMetrics {
  pos_1?: number | null;
  pos_2_3?: number | null;
  pos_4_10?: number | null;
  etv?: number | null;
  count?: number | null;
  is_new?: number | null;
  is_lost?: number | null;
}

interface RawRankedItem {
  keyword_data: RawLabsKeyword;
  ranked_serp_element: {
    serp_item: {
      type: string;
      rank_group?: number;
      rank_absolute?: number;
      url?: string | null;
      etv?: number | null;
      rank_changes?: { previous_rank_absolute?: number | null; is_new?: boolean | null } | null;
    };
  };
}

interface RawCompetitor {
  domain: string;
  avg_position?: number | null;
  intersections?: number | null;
  full_domain_metrics?: { organic?: RawMetrics | null } | null;
  metrics?: { organic?: RawMetrics | null } | null;
}

const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Domain data from DataForSEO Labs (Google):
 * - keywords:    `ranked_keywords/live` (historical_serp_mode live | lost)
 * - competitors: `competitors_domain/live`
 * - overview:    `domain_rank_overview/live` (all locations → country split)
 *                + `historical_rank_overview/live` (monthly history)
 */
export class DataForSeoDomainProvider implements DomainDataProvider {
  readonly name = 'dataforseo';

  constructor(
    private readonly client: DataForSeoClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getDomainKeywords(
    domain: string,
    loc: Locale,
    opts: DomainKeywordQuery,
  ): Promise<DomainKeyword[]> {
    const target = normalizeDomain(domain) ?? domain;
    const mode = opts.mode ?? 'live';
    const [result] = await this.client.post<{ items?: RawRankedItem[] | null }>(
      'dataforseo_labs/google/ranked_keywords/live',
      {
        target,
        location_code: loc.locationCode,
        language_code: loc.languageCode,
        item_types: ['organic'],
        historical_serp_mode: mode,
        limit: Math.min(1000, opts.limit ?? 100),
        offset: opts.offset ?? 0,
        order_by: [
          mode === 'lost'
            ? 'keyword_data.keyword_info.search_volume,desc'
            : 'ranked_serp_element.serp_item.etv,desc',
        ],
      },
    );
    const now = this.now();
    return (result?.items ?? []).map((item) => {
      const m = mapLabsKeyword(item.keyword_data, loc, now);
      const s = item.ranked_serp_element.serp_item;
      const position = Math.max(1, s.rank_group ?? 100);
      const previous = s.rank_changes?.previous_rank_absolute;
      return {
        domain: target,
        keyword: m.keyword,
        locationCode: loc.locationCode,
        languageCode: loc.languageCode,
        position,
        previousPosition: s.rank_changes?.is_new
          ? null
          : typeof previous === 'number'
            ? Math.max(1, previous)
            : null,
        url: s.url ?? `https://${target}/`,
        volume: m.volume,
        cpc: m.cpc,
        kd: m.kd,
        intent: m.intent,
        serpFeatures: m.serpFeatures,
        estTraffic: typeof s.etv === 'number' ? s.etv : null,
      };
    });
  }

  async getCompetitors(domain: string, loc: Locale): Promise<CompetitorCandidate[]> {
    const target = normalizeDomain(domain) ?? domain;
    const [result] = await this.client.post<{ items?: RawCompetitor[] | null }>(
      'dataforseo_labs/google/competitors_domain/live',
      {
        target,
        location_code: loc.locationCode,
        language_code: loc.languageCode,
        item_types: ['organic'],
        exclude_top_domains: true,
        limit: 50,
      },
    );
    return (result?.items ?? [])
      .filter((c) => c.domain && c.domain !== target)
      .map((c) => ({
        domain: c.domain.replace(/^www\./, ''),
        commonKeywords: n(c.intersections),
        domainKeywords: n(c.full_domain_metrics?.organic?.count),
        // The target's keyword count isn't part of this response; callers fill it in.
        targetKeywords: 0,
        avgPosition: typeof c.avg_position === 'number' ? Math.max(1, c.avg_position) : null,
        estTraffic:
          typeof c.full_domain_metrics?.organic?.etv === 'number'
            ? c.full_domain_metrics.organic.etv
            : null,
      }));
  }

  async getDomainOverview(domain: string, loc: Locale): Promise<DomainOverview> {
    const target = normalizeDomain(domain) ?? domain;
    const yearAgo = new Date(this.now());
    yearAgo.setUTCMonth(yearAgo.getUTCMonth() - 12);

    const [byLocation, historical] = await Promise.all([
      this.client.post<{
        items?:
          | {
              location_code: number;
              language_code: string;
              metrics?: { organic?: RawMetrics | null };
            }[]
          | null;
      }>('dataforseo_labs/google/domain_rank_overview/live', { target, limit: 100 }),
      this.client.post<{
        items?: { year: number; month: number; metrics?: { organic?: RawMetrics | null } }[] | null;
      }>('dataforseo_labs/google/historical_rank_overview/live', {
        target,
        location_code: loc.locationCode,
        language_code: loc.languageCode,
        date_from: yearAgo.toISOString().slice(0, 10),
      }),
    ]);

    const items = byLocation[0]?.items ?? [];
    const home =
      items.find(
        (i) => i.location_code === loc.locationCode && i.language_code === loc.languageCode,
      )?.metrics?.organic ??
      items.find((i) => i.location_code === loc.locationCode)?.metrics?.organic ??
      {};
    const top3 = n(home.pos_1) + n(home.pos_2_3);

    // Several languages can exist per country: sum them per location.
    const perCountry = new Map<number, { keywords: number; estTraffic: number }>();
    for (const i of items) {
      const c = perCountry.get(i.location_code) ?? { keywords: 0, estTraffic: 0 };
      c.keywords += n(i.metrics?.organic?.count);
      c.estTraffic += n(i.metrics?.organic?.etv);
      perCountry.set(i.location_code, c);
    }

    return {
      domain: target,
      locationCode: loc.locationCode,
      languageCode: loc.languageCode,
      organicKeywords: n(home.count),
      top3,
      top10: top3 + n(home.pos_4_10),
      top100: n(home.count),
      estTraffic: n(home.etv),
      newKeywords: n(home.is_new),
      lostKeywords: n(home.is_lost),
      history: (historical[0]?.items ?? [])
        .map((h) => ({
          year: h.year,
          month: h.month,
          keywords: n(h.metrics?.organic?.count),
          estTraffic: n(h.metrics?.organic?.etv),
        }))
        .sort((a, b) => a.year - b.year || a.month - b.month),
      countries: [...perCountry.entries()]
        .map(([locationCode, v]) => ({
          locationCode,
          keywords: v.keywords,
          estTraffic: Math.round(v.estTraffic),
        }))
        .sort((a, b) => b.estTraffic - a.estTraffic),
      updatedAt: this.now().toISOString(),
    };
  }
}
