import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  insertDomainKeywords,
  insertDomainOverview,
  insertSerpSnapshot,
  latestDomainKeywords,
  latestDomainOverview,
  latestSerp,
  type ClickHouseClient,
  type SnapshotMode,
} from '@seo/db/clickhouse';
import {
  contentGap,
  countGapCategories,
  discoverCompetitors,
  keywordGap,
  keywordTraffic,
} from '@seo/seo-core';
import {
  AppError,
  can,
  compareKeywords,
  matchesKeywordFilters,
  wordCount,
  type CompetitorDiscovery,
  type ContentGapQuery,
  type ContentGapResponse,
  type DomainKeyword,
  type DomainKeywordRow,
  type DomainKeywordsQuery,
  type DomainLocaleQuery,
  type DomainOverviewResponse,
  type KeywordGapQuery,
  type KeywordGapResponse,
  type KeywordGapRow,
  type Locale,
  type Paginated,
  type TopPage,
} from '@seo/shared';
import { CLICKHOUSE, REDIS } from '../infra/tokens.js';
import type { ResearchContext } from '../keywords/keywords.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { MeteredProviders } from '../providers/metered-providers.service.js';

/** Domain snapshots are reused for a week (matches the provider cache TTL). */
export const DOMAIN_FRESH_DAYS = 7;
/** Keywords fetched per domain snapshot (top by traffic). */
export const DOMAIN_KEYWORD_LIMIT = 1000;
/** Project keywords (top 20) whose SERPs are analysed for competitor discovery. */
export const DISCOVERY_KEYWORDS = 50;

const toLocale = (q: { loc: number; lang: string }): Locale => ({
  locationCode: q.loc,
  languageCode: q.lang as Locale['languageCode'],
});

function toRow(k: DomainKeyword): DomainKeywordRow {
  return {
    keyword: k.keyword,
    position: k.position,
    previousPosition: k.previousPosition,
    change: k.previousPosition === null ? null : k.previousPosition - k.position,
    url: k.url,
    volume: k.volume,
    kd: k.kd,
    cpc: k.cpc,
    intent: k.intent,
    serpFeatures: k.serpFeatures,
    traffic:
      Math.round(
        keywordTraffic({ keyword: k.keyword, url: k.url, volume: k.volume, position: k.position }) *
          10,
      ) / 10,
  };
}

/** Aggregates keyword rows into pages (keywords, traffic, best keyword). */
export function aggregatePages(rows: readonly DomainKeywordRow[]): TopPage[] {
  const pages = new Map<string, TopPage>();
  for (const r of rows) {
    const p = pages.get(r.url) ?? {
      url: r.url,
      keywords: 0,
      traffic: 0,
      topKeyword: r.keyword,
      topKeywordVolume: r.volume,
      topKeywordPosition: r.position,
    };
    p.keywords++;
    p.traffic += r.traffic;
    if (r.volume > p.topKeywordVolume) {
      p.topKeyword = r.keyword;
      p.topKeywordVolume = r.volume;
      p.topKeywordPosition = r.position;
    }
    pages.set(r.url, p);
  }
  return [...pages.values()]
    .map((p) => ({ ...p, traffic: Math.round(p.traffic) }))
    .sort((a, b) => b.traffic - a.traffic || b.keywords - a.keywords);
}

function sortDomainRows(
  rows: DomainKeywordRow[],
  field: DomainKeywordsQuery['sort'],
  dir: 'asc' | 'desc',
) {
  if (field === 'traffic' || field === 'position' || field === 'change') {
    const sign = dir === 'asc' ? 1 : -1;
    return rows.sort((a, b) => {
      const x = a[field];
      const y = b[field];
      if (x === null && y === null) return a.keyword.localeCompare(b.keyword, 'bg');
      if (x === null) return 1;
      if (y === null) return -1;
      return sign * (x - y) || a.keyword.localeCompare(b.keyword, 'bg');
    });
  }
  return rows
    .map((r) => ({ ...r, wordCount: wordCount(r.keyword), competition: null }))
    .sort(compareKeywords(field, dir));
}

@Injectable()
export class DomainsService {
  constructor(
    private readonly metered: MeteredProviders,
    private readonly projects: ProjectsService,
    @Inject(CLICKHOUSE) private readonly ch: ClickHouseClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private assertCanSpend(ctx: ResearchContext) {
    if (!can(ctx.role, 'research:run')) {
      throw new AppError('FORBIDDEN', 'Your role cannot run new research (it spends credits)', {
        permission: 'research:run',
      });
    }
  }

  /** Stored snapshot if fresh, otherwise fetched (and charged) once and stored. */
  private async keywordsSnapshot(
    ctx: ResearchContext,
    domain: string,
    loc: Locale,
    mode: SnapshotMode,
  ) {
    const stored = await latestDomainKeywords(this.ch, domain, loc, mode, DOMAIN_FRESH_DAYS);
    if (stored) return { rows: stored, creditsCharged: 0 };
    this.assertCanSpend(ctx);
    const opts = { limit: DOMAIN_KEYWORD_LIMIT, offset: 0, mode };
    const creditsCharged = this.metered.price('domains', 'getDomainKeywords', domain, loc, opts);
    const rows = await this.metered.call(ctx, 'domains', 'getDomainKeywords', domain, loc, opts);
    await insertDomainKeywords(this.ch, rows, mode);
    return { rows, creditsCharged };
  }

  async overview(ctx: ResearchContext, q: DomainLocaleQuery): Promise<DomainOverviewResponse> {
    const loc = toLocale(q);
    let creditsCharged = 0;
    let stored = await latestDomainOverview(this.ch, q.domain, loc, DOMAIN_FRESH_DAYS);
    if (!stored) {
      this.assertCanSpend(ctx);
      creditsCharged += this.metered.price('domains', 'getDomainOverview', q.domain, loc);
      const overview = await this.metered.call(ctx, 'domains', 'getDomainOverview', q.domain, loc);
      creditsCharged += this.metered.price('backlinks', 'getBacklinkSummary', q.domain);
      const summary = await this.metered
        .call(ctx, 'backlinks', 'getBacklinkSummary', q.domain)
        .catch(() => null);
      const data = {
        overview,
        rating: summary?.rating ?? null,
        referringDomains: summary?.referringDomains ?? null,
        backlinks: summary?.backlinks ?? null,
      };
      await insertDomainOverview(this.ch, data, this.metered.providerName('domains'));
      stored = { ...data, date: new Date().toISOString().slice(0, 10) };
    }

    const snapshot = await this.keywordsSnapshot(ctx, q.domain, loc, 'live');
    creditsCharged += snapshot.creditsCharged;
    const rows = snapshot.rows.map(toRow).sort((a, b) => b.traffic - a.traffic);
    const o = stored.overview;

    return {
      domain: q.domain,
      locationCode: loc.locationCode,
      languageCode: loc.languageCode,
      organicKeywords: o.organicKeywords,
      top3: o.top3,
      top10: o.top10,
      top100: o.top100,
      providerTraffic: o.estTraffic,
      estTraffic: Math.round(rows.reduce((s, r) => s + r.traffic, 0)),
      newKeywords: o.newKeywords,
      lostKeywords: o.lostKeywords,
      rating: stored.rating,
      referringDomains: stored.referringDomains,
      backlinks: stored.backlinks,
      history: o.history,
      countries: o.countries,
      topKeywords: rows.slice(0, 10),
      topPages: aggregatePages(rows).slice(0, 10),
      fetchedAt: o.updatedAt,
      creditsCharged,
    };
  }

  async keywords(
    ctx: ResearchContext,
    q: DomainKeywordsQuery,
  ): Promise<Paginated<DomainKeywordRow> & { creditsCharged: number }> {
    const loc = toLocale(q);
    const mode: SnapshotMode = q.changes === 'lost' ? 'lost' : 'live';
    const snapshot = await this.keywordsSnapshot(ctx, q.domain, loc, mode);
    let rows = snapshot.rows.map(toRow);
    if (q.changes === 'new') rows = rows.filter((r) => r.previousPosition === null);
    rows = rows.filter(
      (r) =>
        matchesKeywordFilters({ ...r, competition: null, wordCount: wordCount(r.keyword) }, q) &&
        (q.minPosition === undefined || r.position >= q.minPosition) &&
        (q.maxPosition === undefined || r.position <= q.maxPosition) &&
        (!q.url || r.url === q.url),
    );
    const sorted = sortDomainRows(rows, q.sort, q.dir);
    const start = (q.page - 1) * q.pageSize;
    return {
      items: sorted.slice(start, start + q.pageSize) as DomainKeywordRow[],
      page: q.page,
      pageSize: q.pageSize,
      total: sorted.length,
      creditsCharged: snapshot.creditsCharged,
    };
  }

  async pages(ctx: ResearchContext, q: DomainLocaleQuery & { page: number; pageSize: number }) {
    const snapshot = await this.keywordsSnapshot(ctx, q.domain, toLocale(q), 'live');
    const pages = aggregatePages(snapshot.rows.map(toRow));
    const start = (q.page - 1) * q.pageSize;
    return {
      items: pages.slice(start, start + q.pageSize),
      page: q.page,
      pageSize: q.pageSize,
      total: pages.length,
      creditsCharged: snapshot.creditsCharged,
    };
  }

  // ------------------------------------------------------------ competitors

  /**
   * Organic competitors of a project: SERP top 20 of its best keywords (top 20 positions),
   * domain frequency, competition level = common / (domain + project − common).
   */
  async discover(ctx: ResearchContext, projectId: string): Promise<CompetitorDiscovery> {
    const project = await this.projects.get(ctx.organizationId, projectId);
    const loc: Locale = {
      locationCode: project.locationCode,
      languageCode: project.languageCode as Locale['languageCode'],
    };
    const cacheKey = `discovery:v1:${project.id}:${project.domain}:${loc.locationCode}:${loc.languageCode}`;
    const tracked = new Set(
      (await this.projects.competitors(ctx.organizationId, projectId)).map((c) => c.domain),
    );

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const res = JSON.parse(cached) as CompetitorDiscovery;
      return {
        ...res,
        competitors: res.competitors.map((c) => ({ ...c, tracked: tracked.has(c.domain) })),
        creditsCharged: 0,
      };
    }

    const snapshot = await this.keywordsSnapshot(ctx, project.domain, loc, 'live');
    let creditsCharged = snapshot.creditsCharged;
    const keywords = snapshot.rows
      .filter((r) => r.position <= 20)
      .sort((a, b) => b.volume - a.volume)
      .slice(0, DISCOVERY_KEYWORDS)
      .map((r) => r.keyword);

    const serps = new Map<string, string[]>();
    const missing: string[] = [];
    for (const k of keywords) {
      const s = await latestSerp(this.ch, k, loc, project.device, 30 * 24);
      if (s && s.depth >= 20) serps.set(k, organicDomains(s.items, 20));
      else missing.push(k);
    }
    if (missing.length) {
      this.assertCanSpend(ctx);
      creditsCharged += this.metered.priceOf('keyword.clusterSerp', missing.length);
      await this.metered.bundle(ctx, 'keyword.clusterSerp', missing.length, async (p) => {
        for (const k of missing) {
          const snap = await p.serp.getSerp(k, loc, project.device, 20);
          await insertSerpSnapshot(this.ch, snap);
          serps.set(k, organicDomains(snap.items, 20));
        }
      });
    }

    // Provider candidates give each domain's total keyword count for the formula.
    let counts = new Map<string, number>();
    if (can(ctx.role, 'research:run')) {
      creditsCharged += this.metered.price('domains', 'getCompetitors', project.domain, loc);
      const candidates = await this.metered
        .call(ctx, 'domains', 'getCompetitors', project.domain, loc)
        .catch(() => []);
      counts = new Map(
        candidates.filter((c) => c.domainKeywords > 0).map((c) => [c.domain, c.domainKeywords]),
      );
    }

    const scores = discoverCompetitors(
      project.domain,
      [...serps.entries()].map(([keyword, domains]) => ({ keyword, domains })),
      { domainKeywordCounts: counts, minCommon: 2, limit: 30 },
    );
    const result: CompetitorDiscovery = {
      domain: project.domain,
      keywordsAnalyzed: serps.size,
      competitors: scores.map((s) => ({
        domain: s.domain,
        commonKeywords: s.commonKeywords,
        domainKeywords: s.domainKeywords,
        competitionLevel: Math.round(s.competitionLevel * 1000) / 1000,
        tracked: tracked.has(s.domain),
      })),
      creditsCharged,
    };
    await this.redis.set(cacheKey, JSON.stringify(result), 'EX', DOMAIN_FRESH_DAYS * 86_400);
    return result;
  }

  // ------------------------------------------------------------ gaps

  private async snapshots(ctx: ResearchContext, domains: readonly string[], loc: Locale) {
    const out = new Map<string, DomainKeyword[]>();
    let creditsCharged = 0;
    for (const d of domains) {
      const s = await this.keywordsSnapshot(ctx, d, loc, 'live');
      out.set(d, s.rows);
      creditsCharged += s.creditsCharged;
    }
    return { snapshots: out, creditsCharged };
  }

  async keywordGap(ctx: ResearchContext, q: KeywordGapQuery): Promise<KeywordGapResponse> {
    const loc = toLocale(q);
    const competitors = [...new Set(q.competitors)].filter((c) => c !== q.target);
    if (!competitors.length)
      throw new AppError(
        'VALIDATION_FAILED',
        'Add at least one competitor different from the target',
      );
    const domains = [q.target, ...competitors];
    const { snapshots, creditsCharged } = await this.snapshots(ctx, domains, loc);

    const metrics = new Map<string, DomainKeyword>();
    for (const rows of snapshots.values())
      for (const r of rows) if (!metrics.has(r.keyword)) metrics.set(r.keyword, r);

    const gap = keywordGap(
      q.target,
      competitors,
      new Map(
        [...snapshots.entries()].map(([d, rows]) => [
          d,
          rows.map((r) => ({ keyword: r.keyword, position: r.position })),
        ]),
      ),
    );
    const counts = countGapCategories(gap);
    const rows: KeywordGapRow[] = gap
      .filter((g) => g.categories.includes(q.tab))
      .map((g) => {
        const m = metrics.get(g.keyword)!;
        return {
          keyword: g.keyword,
          volume: m.volume,
          kd: m.kd,
          cpc: m.cpc,
          intent: m.intent,
          serpFeatures: m.serpFeatures,
          wordCount: wordCount(g.keyword),
          positions: g.positions,
        };
      })
      .filter((r) => matchesKeywordFilters({ ...r, competition: null }, q))
      .sort(compareKeywords(q.sort, q.dir));

    const start = (q.page - 1) * q.pageSize;
    return {
      domains,
      counts,
      items: rows.slice(start, start + q.pageSize),
      page: q.page,
      pageSize: q.pageSize,
      total: rows.length,
      creditsCharged,
    };
  }

  async contentGap(ctx: ResearchContext, q: ContentGapQuery): Promise<ContentGapResponse> {
    const loc = toLocale(q);
    const competitors = [...new Set(q.competitors)].filter((c) => c !== q.target);
    if (!competitors.length)
      throw new AppError(
        'VALIDATION_FAILED',
        'Add at least one competitor different from the target',
      );
    const { snapshots, creditsCharged } = await this.snapshots(
      ctx,
      [q.target, ...competitors],
      loc,
    );
    const targetKeywords = new Set((snapshots.get(q.target) ?? []).map((r) => r.keyword));

    const pages = competitors.flatMap((domain) => {
      const byUrl = new Map<string, DomainKeyword[]>();
      for (const r of snapshots.get(domain) ?? []) {
        const list = byUrl.get(r.url) ?? [];
        list.push(r);
        byUrl.set(r.url, list);
      }
      return [...byUrl.entries()].map(([url, kws]) => ({
        domain,
        url,
        keywords: kws.map((k) => ({ keyword: k.keyword, volume: k.volume, position: k.position })),
        traffic: kws.reduce((s, k) => s + toRow(k).traffic, 0),
      }));
    });

    return {
      topics: contentGap(targetKeywords, pages, { minCompetitors: q.minCompetitors }).slice(0, 200),
      creditsCharged,
    };
  }
}

function organicDomains(
  items: readonly { type: string; domain: string | null; rankGroup: number }[],
  depth: number,
) {
  return items
    .filter((i) => i.type === 'organic' && i.domain && i.rankGroup <= depth)
    .map((i) => i.domain!);
}
