import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { ProviderSet } from '@seo/data-providers';
import {
  getStoredMetrics,
  ideaSetFetchedAt,
  insertIdeaSet,
  insertKeywordMetrics,
  insertSerpSnapshot,
  latestSerp,
  queryIdeas,
  type ClickHouseClient,
} from '@seo/db/clickhouse';
import { ctr, keywordDifficulty, keywordTraffic } from '@seo/seo-core';
import {
  AppError,
  can,
  IDEA_SOURCES,
  type ExplorerQuery,
  type ExplorerResponse,
  type KeywordMetrics,
  type KeywordOverview,
  type Locale,
  type OverviewQuery,
  type Role,
  type SerpSnapshot,
} from '@seo/shared';
import { CLICKHOUSE, REDIS } from '../infra/tokens.js';
import { IntentService } from '../llm/intent.service.js';
import { MeteredProviders, type CallerContext } from '../providers/metered-providers.service.js';

/** How long stored data is reused before calling the provider again. */
export const FRESHNESS = {
  keywordDays: 30,
  ideaSetDays: 30,
  serpHours: 24,
  pageMetricsSec: 7 * 86_400,
} as const;

export interface ResearchContext extends CallerContext {
  role: Role;
}

const normalizeUrl = (u: string) =>
  u
    .replace(/^https?:\/\/(www\.)?/i, '')
    .replace(/[#?].*$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class KeywordsService {
  constructor(
    private readonly metered: MeteredProviders,
    private readonly intents: IntentService,
    @Inject(CLICKHOUSE) private readonly ch: ClickHouseClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Spending credits needs `research:run`; viewers can only read stored data. */
  private assertCanSpend(ctx: ResearchContext) {
    if (!can(ctx.role, 'research:run')) {
      throw new AppError('FORBIDDEN', 'Your role cannot run new research (it spends credits)', {
        permission: 'research:run',
      });
    }
  }

  /**
   * Runs `fn` once across processes for `key`; concurrent callers wait for `ready()`
   * instead of paying for the same provider data twice.
   */
  private async once(key: string, ready: () => Promise<boolean>, fn: () => Promise<void>) {
    const lock = `lock:${key}`;
    if (await this.redis.set(lock, '1', 'PX', 120_000, 'NX')) {
      try {
        await fn();
      } finally {
        await this.redis.del(lock);
      }
      return;
    }
    for (let i = 0; i < 120; i++) {
      await sleep(500);
      if (await ready()) return;
      if (!(await this.redis.exists(lock))) break;
    }
    if (!(await ready())) await fn();
  }

  // ------------------------------------------------------------------ explorer

  async explore(ctx: ResearchContext, q: ExplorerQuery): Promise<ExplorerResponse> {
    const loc: Locale = { locationCode: q.loc, languageCode: q.lang };
    let fetchedAt = await ideaSetFetchedAt(this.ch, q.q, loc, FRESHNESS.ideaSetDays);
    let creditsCharged = 0;

    if (!fetchedAt) {
      this.assertCanSpend(ctx);
      await this.once(
        `ideas:${loc.locationCode}:${loc.languageCode}:${q.q}`,
        async () => !!(await ideaSetFetchedAt(this.ch, q.q, loc, FRESHNESS.ideaSetDays)),
        async () => {
          const opts = { sources: [...IDEA_SOURCES], limit: 1000 };
          creditsCharged = this.metered.price('keywords', 'getKeywordIdeas', q.q, loc, opts);
          const ideas = await this.metered.call(ctx, 'keywords', 'getKeywordIdeas', q.q, loc, opts);
          const withIntent = await this.intents.ensureIntents(ideas, loc.languageCode);
          const provider = this.metered.providerName('keywords');
          await insertKeywordMetrics(this.ch, withIntent, provider);
          await insertIdeaSet(
            this.ch,
            q.q,
            loc,
            ideas.map((i) => ({ keyword: i.keyword, source: i.source })),
            provider,
          );
        },
      );
      fetchedAt = (await ideaSetFetchedAt(this.ch, q.q, loc, FRESHNESS.ideaSetDays)) ?? new Date();
    }

    const result = await queryIdeas(this.ch, {
      seed: q.q,
      loc,
      source: q.source,
      filters: q,
      sort: q.sort,
      dir: q.dir,
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    });
    return {
      seed: q.q,
      locationCode: loc.locationCode,
      languageCode: loc.languageCode,
      items: result.items,
      page: q.page,
      pageSize: q.pageSize,
      total: result.total,
      sourceCounts: result.sourceCounts,
      fetchedAt: fetchedAt.toISOString(),
      creditsCharged,
    };
  }

  /** All filtered explorer rows (no paging) for export; requires stored ideas. */
  async exploreAll(ctx: ResearchContext, q: ExplorerQuery) {
    const loc: Locale = { locationCode: q.loc, languageCode: q.lang };
    if (!(await ideaSetFetchedAt(this.ch, q.q, loc, FRESHNESS.ideaSetDays))) {
      throw new AppError('NOT_FOUND', 'Run the search before exporting it');
    }
    return queryIdeas(this.ch, {
      seed: q.q,
      loc,
      source: q.source,
      filters: q,
      sort: q.sort,
      dir: q.dir,
      limit: 10_000,
      offset: 0,
    });
  }

  // ------------------------------------------------------------------ metrics

  /** Stored metrics where fresh; missing keywords are fetched (and charged) in one call. */
  async ensureMetrics(ctx: ResearchContext, keywords: readonly string[], loc: Locale) {
    const stored = await getStoredMetrics(this.ch, keywords, loc, FRESHNESS.keywordDays);
    const missing = [...new Set(keywords.filter((k) => !stored.has(k)))];
    let creditsCharged = 0;
    if (missing.length) {
      this.assertCanSpend(ctx);
      creditsCharged = this.metered.price('keywords', 'getKeywordMetrics', missing, loc);
      const fetched = await this.metered.call(ctx, 'keywords', 'getKeywordMetrics', missing, loc);
      const withIntent = await this.intents.ensureIntents(fetched, loc.languageCode);
      // Keywords the provider doesn't know are stored with zero volume so we don't refetch them.
      const known = new Set(withIntent.map((m) => m.keyword));
      const unknown = missing.filter((k) => !known.has(k)).map((k) => emptyMetrics(k, loc));
      const all = [...withIntent, ...(await this.intents.ensureIntents(unknown, loc.languageCode))];
      await insertKeywordMetrics(this.ch, all, this.metered.providerName('keywords'));
      for (const m of all) stored.set(m.keyword, m);
    }
    return { metrics: stored, creditsCharged };
  }

  // ------------------------------------------------------------------ overview

  async overview(ctx: ResearchContext, q: OverviewQuery): Promise<KeywordOverview> {
    const loc: Locale = { locationCode: q.loc, languageCode: q.lang };
    const { metrics, creditsCharged: metricCredits } = await this.ensureMetrics(ctx, [q.q], loc);
    const m = metrics.get(q.q)!;
    let creditsCharged = metricCredits;

    let serp = await latestSerp(this.ch, q.q, loc, q.device, FRESHNESS.serpHours);
    if (!serp) {
      this.assertCanSpend(ctx);
      creditsCharged += this.metered.price('serp', 'getSerp', q.q, loc, q.device, 10);
      serp = await this.metered.call(ctx, 'serp', 'getSerp', q.q, loc, q.device, 10);
      await insertSerpSnapshot(this.ch, serp);
    }

    const pages = await this.pageMetrics(ctx, serp, m, loc);
    creditsCharged += pages.creditsCharged;

    const organic = serp.items.filter((i) => i.type === 'organic' && i.url && i.rankGroup <= 10);
    const ownKd = pages.byUrl.size
      ? keywordDifficulty(
          organic.map((o) => ({
            position: o.rankGroup,
            referringDomains: pages.byUrl.get(o.url!)?.referringDomains ?? 0,
            domainRating: pages.byUrl.get(o.url!)?.rating ?? null,
          })),
        )
      : null;

    const serpContext = {
      aiOverview: serp.features.includes('ai_overview'),
      topAds: serp.items.filter(
        (i) => i.type === 'paid' && i.rankAbsolute < (organic[0]?.rankAbsolute ?? 0),
      ).length,
    };
    const featured = serp.items.find((i) => i.type === 'featured_snippet');

    return {
      metrics: m,
      kd: ownKd ?? m.kd,
      kdSource: ownKd !== null ? 'computed' : m.kd !== null ? 'provider' : 'none',
      parentTopic: pages.parentTopic,
      trafficPotential: pages.trafficPotential,
      serp: {
        checkedAt: serp.checkedAt,
        device: serp.device,
        totalResults: serp.totalResults,
        features: serp.features,
        results: organic.map((o) => {
          const pm = pages.byUrl.get(o.url!);
          return {
            position: o.rankGroup,
            url: o.url!,
            domain: o.domain ?? '',
            title: o.title,
            referringDomains: pm?.referringDomains ?? null,
            backlinks: pm?.backlinks ?? null,
            domainRating: pm?.rating ?? null,
            estTraffic: Math.round(
              m.volume *
                ctr(o.rankGroup, {
                  ...serpContext,
                  featuredSnippetOtherDomain: !!featured && featured.domain !== o.domain,
                }),
            ),
          };
        }),
        peopleAlsoAsk: serp.items
          .filter((i) => i.type === 'people_also_ask')
          .flatMap((i) => (i.extra?.questions as string[] | undefined) ?? []),
        aiOverviewReferences: serp.items
          .filter((i) => i.type === 'ai_overview')
          .flatMap((i) => (i.extra?.references as string[] | undefined) ?? []),
      },
      creditsCharged,
    };
  }

  /**
   * Backlink metrics of the top-10 pages + parent topic / traffic potential of the #1
   * page. Charged once as `serp.pageMetrics` and cached for a week per SERP snapshot.
   */
  private async pageMetrics(
    ctx: ResearchContext,
    serp: SerpSnapshot,
    m: KeywordMetrics,
    loc: Locale,
  ) {
    type Page = { referringDomains: number; backlinks: number; rating: number };
    type Cached = {
      pages: [string, Page][];
      parentTopic: string | null;
      trafficPotential: number | null;
    };
    const cacheKey = `kw:pages:v1:${loc.locationCode}:${loc.languageCode}:${serp.device}:${m.keyword}:${serp.checkedAt}`;
    const hit = await this.redis.get(cacheKey);
    if (hit) {
      const c = JSON.parse(hit) as Cached;
      return {
        byUrl: new Map(c.pages),
        parentTopic: c.parentTopic,
        trafficPotential: c.trafficPotential,
        creditsCharged: 0,
      };
    }
    // Viewers see the overview without page metrics rather than an error.
    if (!can(ctx.role, 'research:run')) {
      return {
        byUrl: new Map<string, Page>(),
        parentTopic: null,
        trafficPotential: null,
        creditsCharged: 0,
      };
    }

    const organic = serp.items.filter((i) => i.type === 'organic' && i.url && i.rankGroup <= 10);
    const creditsCharged = this.metered.priceOf('serp.pageMetrics');
    const result = await this.metered.bundle(ctx, 'serp.pageMetrics', 1, async (p: ProviderSet) => {
      const summaries = await Promise.all(
        organic.map(async (o) => {
          const s = await p.backlinks.getBacklinkSummary(o.url!).catch(() => null);
          return [
            o.url!,
            s
              ? { referringDomains: s.referringDomains, backlinks: s.backlinks, rating: s.rating }
              : null,
          ] as const;
        }),
      );
      const pages = summaries
        .filter((e): e is readonly [string, Page] => e[1] !== null)
        .map(([u, s]) => [u, s] as [string, Page]);

      // Parent topic & traffic potential from what the #1 page ranks for. Only when the
      // domain data comes from the same source as the SERP (no mixing mock and real data).
      let parentTopic: string | null = null;
      let trafficPotential: number | null = null;
      const top = organic[0];
      if (top?.domain && p.domains.name === p.serp.name) {
        const rows = await p.domains
          .getDomainKeywords(top.domain, loc, { limit: 1000, offset: 0 })
          .catch(() => []);
        const target = normalizeUrl(top.url!);
        const same = rows.filter((r) => normalizeUrl(r.url) === target);
        if (same.length) {
          parentTopic = same.reduce((best, r) => (r.volume > best.volume ? r : best)).keyword;
          trafficPotential = Math.round(
            same.reduce(
              (s, r) =>
                s +
                keywordTraffic({
                  keyword: r.keyword,
                  url: r.url,
                  volume: r.volume,
                  position: r.position,
                }),
              0,
            ),
          );
        }
      }
      if (trafficPotential === null) trafficPotential = Math.round(m.volume * ctr(1));
      return { pages, parentTopic, trafficPotential };
    });

    await this.redis.set(cacheKey, JSON.stringify(result), 'EX', FRESHNESS.pageMetricsSec);
    return {
      byUrl: new Map(result.pages),
      parentTopic: result.parentTopic,
      trafficPotential: result.trafficPotential,
      creditsCharged,
    };
  }
}

export function emptyMetrics(keyword: string, loc: Locale): KeywordMetrics {
  return {
    keyword,
    locationCode: loc.locationCode,
    languageCode: loc.languageCode,
    volume: 0,
    cpc: null,
    competition: null,
    competitionLevel: null,
    trend: [],
    kd: null,
    intent: [],
    serpFeatures: [],
    updatedAt: new Date().toISOString(),
  };
}
