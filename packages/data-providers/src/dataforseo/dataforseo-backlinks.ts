import {
  normalizeDomain,
  type Backlink,
  type BacklinkQuery,
  type BacklinkSummary,
  type LinkRel,
  type Paging,
  type ReferringDomain,
} from '@seo/shared';
import type { BacklinkProvider } from '../types.js';
import type { DataForSeoClient } from './client.js';

/** Max page size of backlinks/live and referring_domains/live. */
const MAX_LIMIT = 1000;
/** backlinks/live rejects offsets above this (search_after_token is needed beyond). */
const MAX_OFFSET = 20_000;

interface RawSummary {
  target: string;
  rank?: number | null;
  backlinks?: number | null;
  broken_backlinks?: number | null;
  referring_domains?: number | null;
  referring_ips?: number | null;
  referring_links_attributes?: Record<string, number> | null;
  info?: { target_spam_score?: number | null } | null;
}

interface RawBacklink {
  domain_from: string;
  url_from: string;
  domain_to: string;
  url_to: string;
  anchor?: string | null;
  dofollow?: boolean | null;
  attributes?: string[] | null;
  item_type?: string | null;
  domain_from_rank?: number | null;
  first_seen?: string | null;
  last_seen?: string | null;
  is_lost?: boolean | null;
  url_to_status_code?: number | null;
  backlink_spam_score?: number | null;
}

interface RawReferringDomain {
  domain: string;
  rank?: number | null;
  backlinks?: number | null;
  first_seen?: string | null;
  lost_date?: string | null;
  backlinks_spam_score?: number | null;
  referring_links_attributes?: Record<string, number> | null;
}

const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const score = (v: number | null | undefined) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null;

/** DataForSEO dates look like "2019-11-15 12:57:46 +00:00" (UTC). */
export function parseDfsDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function rel(item: RawBacklink): LinkRel {
  const attrs = item.attributes ?? [];
  if (attrs.includes('sponsored')) return 'sponsored';
  if (attrs.includes('ugc')) return 'ugc';
  return item.dofollow === false || attrs.includes('nofollow') ? 'nofollow' : 'follow';
}

const LINK_TYPE: Record<string, Backlink['linkType']> = {
  anchor: 'text',
  link: 'text',
  image: 'image',
  redirect: 'redirect',
  canonical: 'canonical',
};

/**
 * Backlinks API v3 (live): `summary/live`, `backlinks/live`, `referring_domains/live`.
 * Ranks are requested on the 0–100 scale (`rank_scale: one_hundred`).
 */
export class DataForSeoBacklinkProvider implements BacklinkProvider {
  readonly name = 'dataforseo';

  constructor(
    private readonly client: DataForSeoClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getBacklinkSummary(target: string): Promise<BacklinkSummary> {
    const t = normalizeDomain(target) ?? target;
    const [r] = await this.client.post<RawSummary>('backlinks/summary/live', {
      target: t,
      rank_scale: 'one_hundred',
      backlinks_status_type: 'live',
    });
    const backlinks = n(r?.backlinks);
    const nofollow = Math.min(backlinks, n(r?.referring_links_attributes?.nofollow));
    return {
      target: t,
      backlinks,
      referringDomains: n(r?.referring_domains),
      referringIps: r?.referring_ips ?? null,
      rating: score(r?.rank) ?? 0,
      dofollow: backlinks - nofollow,
      nofollow,
      brokenBacklinks: n(r?.broken_backlinks),
      spamScore: score(r?.info?.target_spam_score),
      updatedAt: this.now().toISOString(),
    };
  }

  async getBacklinks(target: string, opts: BacklinkQuery): Promise<Backlink[]> {
    const t = normalizeDomain(target) ?? target;
    const filters =
      opts.rel === 'follow'
        ? ['dofollow', '=', true]
        : opts.rel === 'nofollow'
          ? ['dofollow', '=', false]
          : undefined;
    const [r] = await this.client.post<{ items?: RawBacklink[] | null }>(
      'backlinks/backlinks/live',
      {
        target: t,
        mode: opts.onePerDomain ? 'one_per_domain' : 'as_is',
        backlinks_status_type: opts.status,
        limit: Math.min(MAX_LIMIT, opts.limit),
        offset: Math.min(MAX_OFFSET, opts.offset),
        order_by: ['rank,desc'],
        rank_scale: 'one_hundred',
        ...(filters && { filters }),
      },
    );
    const items = (r?.items ?? []).map((i): Backlink => {
      const lastSeen = parseDfsDate(i.last_seen) ?? this.now().toISOString();
      return {
        sourceUrl: i.url_from,
        sourceDomain: normalizeDomain(i.domain_from) ?? i.domain_from,
        targetUrl: i.url_to,
        targetDomain: normalizeDomain(i.domain_to) ?? i.domain_to,
        anchor: i.anchor ?? '',
        rel: rel(i),
        linkType: LINK_TYPE[i.item_type ?? ''] ?? 'other',
        sourceRating: score(i.domain_from_rank) ?? 0,
        firstSeen: parseDfsDate(i.first_seen) ?? lastSeen,
        lastSeen,
        lostAt: i.is_lost ? lastSeen : null,
        targetStatus: i.url_to_status_code ?? null,
        spamScore: score(i.backlink_spam_score),
      };
    });
    // ugc/sponsored are attributes, not a documented filter: narrow down locally.
    return opts.rel === 'ugc' || opts.rel === 'sponsored'
      ? items.filter((b) => b.rel === opts.rel)
      : items;
  }

  async getReferringDomains(target: string, opts: Paging): Promise<ReferringDomain[]> {
    const t = normalizeDomain(target) ?? target;
    const [r] = await this.client.post<{ items?: RawReferringDomain[] | null }>(
      'backlinks/referring_domains/live',
      {
        target: t,
        backlinks_status_type: 'all',
        limit: Math.min(MAX_LIMIT, opts.limit),
        offset: opts.offset,
        order_by: ['rank,desc'],
        rank_scale: 'one_hundred',
      },
    );
    const now = this.now().toISOString();
    return (r?.items ?? []).map((i) => {
      const backlinks = n(i.backlinks);
      const lostAt = parseDfsDate(i.lost_date);
      return {
        domain: normalizeDomain(i.domain) ?? i.domain,
        backlinks,
        dofollow: Math.max(0, backlinks - n(i.referring_links_attributes?.nofollow)),
        rating: score(i.rank) ?? 0,
        firstSeen: parseDfsDate(i.first_seen) ?? now,
        // The endpoint has no last-seen date: a live domain was seen in the latest crawl.
        lastSeen: lostAt ?? now,
        lostAt,
        spamScore: score(i.backlinks_spam_score),
      };
    });
  }
}
