import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, getOrganizationPlan, inArray, schema, type Database } from '@seo/db';
import {
  competitorRankHistory,
  getStoredMetrics,
  rankHistory,
  rankSeriesKey,
  type ClickHouseClient,
  type StoredRank,
} from '@seo/db/clickhouse';
import {
  averagePosition,
  expectedClicks,
  positionChange,
  positionDistribution,
  shareOfVoice,
  visibility,
} from '@seo/seo-core';
import {
  AppError,
  can,
  PLANS,
  type Job,
  type KeywordHistory,
  type Locale,
  type RankAlert,
  type RankAlertEvent,
  type RankCheckJobInput,
  type RankingsQuery,
  type RankingsResponse,
  type RankingsSummary,
  type RankingsSummaryQuery,
  type TrackedKeywordRow,
} from '@seo/shared';
import type { z } from 'zod';
import type {
  addTrackedKeywordsSchema,
  createRankAlertSchema,
  updateRankAlertSchema,
} from '@seo/shared';
import { AuditService } from '../audit/audit.service.js';
import { CreditsService } from '../credits/credits.service.js';
import { CLICKHOUSE, DB } from '../infra/tokens.js';
import { JobsService } from '../jobs/jobs.service.js';
import { KeywordsService, type ResearchContext } from '../keywords/keywords.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { MeteredProviders } from '../providers/metered-providers.service.js';

type TrackedRow = typeof schema.trackedKeywords.$inferSelect;
type AlertRow = typeof schema.rankAlerts.$inferSelect;

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * DAY));
const SPARKLINE_POINTS = 30;
const MOVERS = 5;

const seriesKey = (k: Pick<TrackedRow, 'keyword' | 'device' | 'locationCode' | 'languageCode'>) =>
  rankSeriesKey(k);

/** Position at the last check on or before `date` (series sorted oldest first). */
function positionAt(points: readonly StoredRank[], date: string): StoredRank | undefined {
  let hit: StoredRank | undefined;
  for (const p of points) {
    if (p.date > date) break;
    hit = p;
  }
  return hit;
}

function toAlert(r: AlertRow): RankAlert {
  return {
    id: r.id,
    type: r.type,
    threshold: r.threshold,
    tag: r.tag,
    emails: r.emails,
    enabled: r.enabled,
    createdAt: r.createdAt.toISOString(),
  };
}

@Injectable()
export class RankingsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLICKHOUSE) private readonly ch: ClickHouseClient,
    private readonly projects: ProjectsService,
    private readonly keywords: KeywordsService,
    private readonly credits: CreditsService,
    private readonly jobs: JobsService,
    private readonly metered: MeteredProviders,
    private readonly audit: AuditService,
  ) {}

  private assertCanSpend(ctx: ResearchContext) {
    if (!can(ctx.role, 'research:run'))
      throw new AppError('FORBIDDEN', 'Your role cannot run new research (it spends credits)', {
        permission: 'research:run',
      });
  }

  private tracked(organizationId: string, projectId: string) {
    return this.db
      .select()
      .from(schema.trackedKeywords)
      .where(
        and(
          eq(schema.trackedKeywords.organizationId, organizationId),
          eq(schema.trackedKeywords.projectId, projectId),
        ),
      )
      .orderBy(schema.trackedKeywords.createdAt);
  }

  /** History grouped by series (oldest first), limited to the tracked keywords. */
  private async series(projectId: string, tracked: readonly TrackedRow[], fromDate: string) {
    const rows = tracked.length ? await rankHistory(this.ch, projectId, fromDate) : [];
    const keys = new Set(tracked.map(seriesKey));
    const out = new Map<string, StoredRank[]>();
    for (const r of rows) {
      const key = rankSeriesKey(r);
      if (!keys.has(key)) continue;
      out.set(key, [...(out.get(key) ?? []), r]);
    }
    return out;
  }

  // ------------------------------------------------------------- keywords

  async list(ctx: ResearchContext, projectId: string, q: RankingsQuery): Promise<RankingsResponse> {
    const project = await this.projects.get(ctx.organizationId, projectId);
    const all = await this.tracked(ctx.organizationId, project.id);
    const competitors = (await this.projects.competitors(ctx.organizationId, project.id)).map(
      (c) => c.domain,
    );
    const history = await this.series(project.id, all, daysAgo(40));
    const compRows = all.length
      ? await competitorRankHistory(this.ch, project.id, daysAgo(14))
      : [];
    const latestComp = new Map<string, Record<string, number | null>>();
    for (const r of compRows) {
      // Rows are oldest first: later dates overwrite earlier ones.
      const key = rankSeriesKey(r);
      latestComp.set(key, { ...(latestComp.get(key) ?? {}), [r.domain]: r.position });
    }

    // Volume for keywords that were never checked comes from stored metrics.
    const unchecked = all.filter((k) => !history.has(seriesKey(k)));
    const storedVolume = new Map<string, number>();
    for (const k of unchecked) {
      if (storedVolume.has(`${k.keyword}|${k.locationCode}|${k.languageCode}`)) continue;
      const loc = { locationCode: k.locationCode, languageCode: k.languageCode } as Locale;
      const m = await getStoredMetrics(this.ch, [k.keyword], loc, 365);
      storedVolume.set(
        `${k.keyword}|${k.locationCode}|${k.languageCode}`,
        m.get(k.keyword)?.volume ?? 0,
      );
    }

    let rows: TrackedKeywordRow[] = all.map((k) => {
      const points = history.get(seriesKey(k)) ?? [];
      const last = points.at(-1);
      const prev = points.at(-2);
      const at = (days: number) =>
        last ? positionAt(points, isoDay(new Date(Date.parse(last.date) - days * DAY))) : undefined;
      const position = last?.position ?? null;
      const volume =
        last?.volume ?? storedVolume.get(`${k.keyword}|${k.locationCode}|${k.languageCode}`) ?? 0;
      const ranked = points.map((p) => p.position).filter((p): p is number => p !== null);
      const comp = latestComp.get(seriesKey(k)) ?? {};
      return {
        id: k.id,
        keyword: k.keyword,
        device: k.device,
        locationCode: k.locationCode,
        languageCode: k.languageCode,
        tags: k.tags,
        position,
        previousPosition: prev?.position ?? null,
        change1d: prev ? positionChange(prev.position, position) : null,
        change7d: positionChange(at(7)?.position ?? null, position),
        change30d: positionChange(at(30)?.position ?? null, position),
        best: ranked.length ? Math.min(...ranked) : null,
        url: last?.url || null,
        volume,
        traffic: Math.round(expectedClicks(position, volume) * 10) / 10,
        serpFeatures: (last?.serpFeatures ?? []) as TrackedKeywordRow['serpFeatures'],
        history: points.slice(-SPARKLINE_POINTS).map((p) => p.position),
        competitors: Object.fromEntries(competitors.map((d) => [d, comp[d] ?? null])),
        lastCheckedAt: k.lastCheckedAt?.toISOString() ?? null,
        createdAt: k.createdAt.toISOString(),
      };
    });

    const needle = q.q?.toLowerCase();
    rows = rows.filter((r) => {
      if (q.device && r.device !== q.device) return false;
      if (q.tag && !r.tags.includes(q.tag)) return false;
      if (needle && !r.keyword.includes(needle)) return false;
      if (q.minPosition !== undefined && (r.position === null || r.position < q.minPosition))
        return false;
      if (q.maxPosition !== undefined && (r.position === null || r.position > q.maxPosition))
        return false;
      switch (q.changes) {
        case 'up':
          return (r.change1d ?? 0) > 0;
        case 'down':
          return (r.change1d ?? 0) < 0;
        case 'new':
          return r.position !== null && r.previousPosition === null && r.history.length > 1;
        case 'lost':
          return r.position === null && r.previousPosition !== null;
        default:
          return true;
      }
    });

    const sign = q.dir === 'asc' ? 1 : -1;
    const value = (r: TrackedKeywordRow): number | string | null =>
      q.sort === 'keyword' ? r.keyword : (r[q.sort] as number | null);
    rows.sort((a, b) => {
      const x = value(a);
      const y = value(b);
      if (x === null && y === null) return a.keyword.localeCompare(b.keyword, 'bg');
      if (x === null) return 1;
      if (y === null) return -1;
      if (typeof x === 'string' || typeof y === 'string')
        return sign * String(x).localeCompare(String(y), 'bg');
      return sign * (x - y) || a.keyword.localeCompare(b.keyword, 'bg');
    });

    const start = (q.page - 1) * q.pageSize;
    const lastChecked = all
      .map((k) => k.lastCheckedAt?.getTime() ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);
    return {
      items: rows.slice(start, start + q.pageSize),
      page: q.page,
      pageSize: q.pageSize,
      total: rows.length,
      tags: [...new Set(all.flatMap((k) => k.tags))].sort(),
      competitors,
      lastCheckedAt: lastChecked ? new Date(lastChecked).toISOString() : null,
      limit: await this.limit(ctx.organizationId),
    };
  }

  private async limit(organizationId: string) {
    const plan = await getOrganizationPlan(this.db, organizationId);
    const [row] = await this.db
      .select({ n: count() })
      .from(schema.trackedKeywords)
      .where(eq(schema.trackedKeywords.organizationId, organizationId));
    return { used: Number(row?.n ?? 0), max: PLANS[plan].maxTrackedKeywords };
  }

  /**
   * Adds keywords (one row per device), fetches missing volumes and starts the first
   * check of the new keywords right away (charged as `rank.check`).
   */
  async add(
    ctx: ResearchContext,
    projectId: string,
    input: z.output<typeof addTrackedKeywordsSchema>,
  ): Promise<{ added: number; skipped: number; creditsCharged: number; job: Job | null }> {
    const project = await this.projects.get(ctx.organizationId, projectId);
    const loc: Locale = {
      locationCode: project.locationCode,
      languageCode: project.languageCode as Locale['languageCode'],
    };
    const keywords = [...new Set(input.keywords.filter(Boolean))];
    const candidates = keywords.flatMap((keyword) =>
      input.devices.map((device) => ({ keyword, device })),
    );

    const existing = new Set(
      (await this.tracked(ctx.organizationId, project.id)).map((k) => `${k.keyword}|${k.device}`),
    );
    const fresh = candidates.filter((c) => !existing.has(`${c.keyword}|${c.device}`));
    const { used, max } = await this.limit(ctx.organizationId);
    if (used + fresh.length > max) {
      throw new AppError('PLAN_LIMIT_REACHED', `Your plan allows up to ${max} tracked keywords`, {
        limit: max,
        used,
        resource: 'trackedKeywords',
      });
    }
    if (!fresh.length)
      return { added: 0, skipped: candidates.length, creditsCharged: 0, job: null };

    const checkCost = this.metered.priceOf('rank.check', fresh.length);
    this.assertCanSpend(ctx);
    const { creditsCharged: metricsCost } = await this.keywords.ensureMetrics(
      ctx,
      [...new Set(fresh.map((f) => f.keyword))],
      loc,
    );

    const inserted = await this.db
      .insert(schema.trackedKeywords)
      .values(
        fresh.map((f) => ({
          organizationId: ctx.organizationId,
          projectId: project.id,
          keyword: f.keyword,
          locationCode: loc.locationCode,
          languageCode: loc.languageCode,
          device: f.device,
          tags: input.tags,
          createdBy: ctx.userId ?? null,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: schema.trackedKeywords.id });

    await this.audit.log({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId ?? null,
      action: 'rankings.keywords_added',
      targetType: 'project',
      targetId: project.id,
      metadata: { count: inserted.length },
    });

    const job = inserted.length
      ? await this.startCheck(
          ctx,
          project.id,
          inserted.map((r) => r.id),
          checkCost,
        )
      : null;
    return {
      added: inserted.length,
      skipped: candidates.length - inserted.length,
      creditsCharged: metricsCost + (job ? checkCost : 0),
      job,
    };
  }

  private startCheck(
    ctx: ResearchContext,
    projectId: string,
    ids: string[] | undefined,
    cost: number,
  ) {
    return this.credits.withCharge(
      {
        organizationId: ctx.organizationId,
        userId: ctx.userId ?? null,
        description: 'rank.check',
        refType: 'project',
        refId: projectId,
      },
      cost,
      () =>
        this.jobs.enqueue<RankCheckJobInput>(
          'rankings.check',
          { projectId, trackedKeywordIds: ids, trigger: 'manual', creditsCharged: cost },
          { organizationId: ctx.organizationId, userId: ctx.userId ?? '' },
        ),
    );
  }

  /** Manual re-check of every tracked keyword of the project. */
  async check(ctx: ResearchContext, projectId: string): Promise<Job> {
    const project = await this.projects.get(ctx.organizationId, projectId);
    const tracked = await this.tracked(ctx.organizationId, project.id);
    if (!tracked.length) throw new AppError('VALIDATION_FAILED', 'Add keywords to track first');
    this.assertCanSpend(ctx);
    return this.startCheck(
      ctx,
      project.id,
      undefined,
      this.metered.priceOf('rank.check', tracked.length),
    );
  }

  async remove(ctx: ResearchContext, projectId: string, ids: string[]) {
    const project = await this.projects.get(ctx.organizationId, projectId);
    const removed = await this.db
      .delete(schema.trackedKeywords)
      .where(
        and(
          eq(schema.trackedKeywords.organizationId, ctx.organizationId),
          eq(schema.trackedKeywords.projectId, project.id),
          inArray(schema.trackedKeywords.id, ids),
        ),
      )
      .returning({ id: schema.trackedKeywords.id });
    return { removed: removed.length };
  }

  async updateTags(ctx: ResearchContext, projectId: string, id: string, tags: string[]) {
    const project = await this.projects.get(ctx.organizationId, projectId);
    const [row] = await this.db
      .update(schema.trackedKeywords)
      .set({ tags: [...new Set(tags)] })
      .where(
        and(
          eq(schema.trackedKeywords.organizationId, ctx.organizationId),
          eq(schema.trackedKeywords.projectId, project.id),
          eq(schema.trackedKeywords.id, id),
        ),
      )
      .returning({ id: schema.trackedKeywords.id });
    if (!row) throw new AppError('NOT_FOUND', 'Tracked keyword not found');
  }

  // -------------------------------------------------------------- summary

  async summary(
    ctx: ResearchContext,
    projectId: string,
    q: RankingsSummaryQuery,
  ): Promise<RankingsSummary> {
    const project = await this.projects.get(ctx.organizationId, projectId);
    const tracked = (await this.tracked(ctx.organizationId, project.id)).filter(
      (k) => (!q.device || k.device === q.device) && (!q.tag || k.tags.includes(q.tag)),
    );
    const from = daysAgo(q.days);
    const history = await this.series(project.id, tracked, from);
    const competitors = (await this.projects.competitors(ctx.organizationId, project.id)).map(
      (c) => c.domain,
    );
    const keys = new Set(tracked.map(seriesKey));
    const compRows = tracked.length
      ? (await competitorRankHistory(this.ch, project.id, from)).filter((r) =>
          keys.has(rankSeriesKey(r)),
        )
      : [];

    const dates = [...new Set([...history.values()].flatMap((p) => p.map((x) => x.date)))].sort();
    const trend = dates.map((date) => {
      const rows = [...history.values()]
        .map((p) => p.find((x) => x.date === date))
        .filter((x): x is StoredRank => !!x);
      const dist = positionDistribution(rows.map((r) => r.position));
      return {
        date,
        visibility: visibility(rows),
        avgPosition: averagePosition(rows.map((r) => r.position)),
        top3: dist.top3,
        top10: dist.top10,
        volatility:
          Math.round((rows.reduce((s, r) => s + r.volatility, 0) / Math.max(1, rows.length)) * 10) /
          10,
      };
    });

    // Current state = latest check of every series.
    const latest = [...history.values()].map((p) => p.at(-1)!).filter(Boolean);
    const previous = new Map(
      [...history.entries()].map(([k, p]) => [k, p.length > 1 ? p.at(-2)! : undefined]),
    );
    const prevVisibility = trend.length > 1 ? trend.at(-2)!.visibility : null;
    const currentVisibility = visibility(latest);

    const changes = tracked
      .map((k) => {
        const points = history.get(seriesKey(k));
        const cur = points?.at(-1);
        const prev = previous.get(seriesKey(k));
        if (!cur || !prev) return null;
        // Entering or leaving the top 100 counts as a move from/to position 101.
        const change = (prev.position ?? 101) - (cur.position ?? 101);
        return {
          id: k.id,
          keyword: k.keyword,
          device: k.device,
          position: cur.position,
          previousPosition: prev.position,
          change,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null && x.change !== 0);

    // Share of voice per date: project + competitors over the same keywords.
    const volumeOf = new Map(latest.map((r) => [rankSeriesKey(r), r.volume]));
    const sovAt = (date: string) => {
      const byDomain = new Map<string, { position: number | null; volume: number }[]>();
      byDomain.set(
        project.domain,
        [...history.values()]
          .map((p) => p.find((x) => x.date === date))
          .filter((x): x is StoredRank => !!x)
          .map((r) => ({ position: r.position, volume: r.volume })),
      );
      for (const d of competitors) byDomain.set(d, []);
      for (const r of compRows)
        if (r.date === date)
          byDomain.get(r.domain)?.push({
            position: r.position,
            volume: volumeOf.get(rankSeriesKey(r)) ?? 0,
          });
      return shareOfVoice(byDomain);
    };
    const lastDate = dates.at(-1);
    const sov = lastDate ? sovAt(lastDate) : new Map<string, number>();
    const lastChecked = tracked
      .map((k) => k.lastCheckedAt?.getTime() ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);

    return {
      keywords: tracked.length,
      ranked: latest.filter((r) => r.position !== null).length,
      avgPosition: averagePosition(latest.map((r) => r.position)),
      visibility: currentVisibility,
      visibilityChange:
        prevVisibility === null
          ? null
          : Math.round((currentVisibility - prevVisibility) * 100) / 100,
      improved: changes.filter((c) => c.change > 0).length,
      declined: changes.filter((c) => c.change < 0).length,
      distribution: positionDistribution([
        ...latest.map((r) => r.position),
        // Never-checked keywords count as not ranked yet.
        ...tracked.filter((k) => !history.has(seriesKey(k))).map(() => null),
      ]),
      trend,
      shareOfVoice: [...sov.entries()]
        .map(([domain, share]) => ({ domain, share, isProject: domain === project.domain }))
        .sort((a, b) => b.share - a.share),
      sovTrend: dates.map((date) => ({ date, shares: Object.fromEntries(sovAt(date)) })),
      movers: {
        up: changes
          .filter((c) => c.change > 0)
          .sort((a, b) => b.change - a.change)
          .slice(0, MOVERS),
        down: changes
          .filter((c) => c.change < 0)
          .sort((a, b) => a.change - b.change)
          .slice(0, MOVERS),
      },
      lastCheckedAt: lastChecked ? new Date(lastChecked).toISOString() : null,
    };
  }

  async history(
    ctx: ResearchContext,
    projectId: string,
    trackedId: string,
    days: number,
  ): Promise<KeywordHistory> {
    const project = await this.projects.get(ctx.organizationId, projectId);
    const [k] = await this.db
      .select()
      .from(schema.trackedKeywords)
      .where(
        and(
          eq(schema.trackedKeywords.organizationId, ctx.organizationId),
          eq(schema.trackedKeywords.projectId, project.id),
          eq(schema.trackedKeywords.id, trackedId),
        ),
      );
    if (!k) throw new AppError('NOT_FOUND', 'Tracked keyword not found');
    const from = daysAgo(days);
    const key = seriesKey(k);
    const points = (await rankHistory(this.ch, project.id, from, { keywords: [k.keyword] })).filter(
      (r) => rankSeriesKey(r) === key,
    );
    const comp = (
      await competitorRankHistory(this.ch, project.id, from, { keywords: [k.keyword] })
    ).filter((r) => rankSeriesKey(r) === key);
    const byDomain = new Map<string, { date: string; position: number | null }[]>();
    for (const r of comp)
      byDomain.set(r.domain, [
        ...(byDomain.get(r.domain) ?? []),
        { date: r.date, position: r.position },
      ]);
    return {
      id: k.id,
      keyword: k.keyword,
      device: k.device,
      points: points.map((p) => ({ date: p.date, position: p.position, url: p.url })),
      competitors: [...byDomain.entries()].map(([domain, pts]) => ({ domain, points: pts })),
    };
  }

  // --------------------------------------------------------------- alerts

  async alerts(ctx: ResearchContext, projectId: string): Promise<RankAlert[]> {
    const project = await this.projects.get(ctx.organizationId, projectId);
    const rows = await this.db
      .select()
      .from(schema.rankAlerts)
      .where(
        and(
          eq(schema.rankAlerts.organizationId, ctx.organizationId),
          eq(schema.rankAlerts.projectId, project.id),
        ),
      )
      .orderBy(schema.rankAlerts.createdAt);
    return rows.map(toAlert);
  }

  async createAlert(
    ctx: ResearchContext,
    projectId: string,
    input: z.output<typeof createRankAlertSchema>,
  ): Promise<RankAlert> {
    const project = await this.projects.get(ctx.organizationId, projectId);
    const [row] = await this.db
      .insert(schema.rankAlerts)
      .values({
        organizationId: ctx.organizationId,
        projectId: project.id,
        type: input.type,
        threshold: input.threshold,
        tag: input.tag ?? null,
        emails: [...new Set(input.emails.map((e) => e.toLowerCase()))],
        enabled: input.enabled,
        createdBy: ctx.userId ?? null,
      })
      .returning();
    return toAlert(row!);
  }

  async updateAlert(
    ctx: ResearchContext,
    projectId: string,
    alertId: string,
    input: z.output<typeof updateRankAlertSchema>,
  ): Promise<RankAlert> {
    const project = await this.projects.get(ctx.organizationId, projectId);
    const [row] = await this.db
      .update(schema.rankAlerts)
      .set({
        ...(input.type !== undefined && { type: input.type }),
        ...(input.threshold !== undefined && { threshold: input.threshold }),
        ...(input.tag !== undefined && { tag: input.tag }),
        ...(input.emails !== undefined && {
          emails: [...new Set(input.emails.map((e) => e.toLowerCase()))],
        }),
        ...(input.enabled !== undefined && { enabled: input.enabled }),
      })
      .where(
        and(
          eq(schema.rankAlerts.organizationId, ctx.organizationId),
          eq(schema.rankAlerts.projectId, project.id),
          eq(schema.rankAlerts.id, alertId),
        ),
      )
      .returning();
    if (!row) throw new AppError('NOT_FOUND', 'Alert not found');
    return toAlert(row);
  }

  async deleteAlert(ctx: ResearchContext, projectId: string, alertId: string) {
    const project = await this.projects.get(ctx.organizationId, projectId);
    const [row] = await this.db
      .delete(schema.rankAlerts)
      .where(
        and(
          eq(schema.rankAlerts.organizationId, ctx.organizationId),
          eq(schema.rankAlerts.projectId, project.id),
          eq(schema.rankAlerts.id, alertId),
        ),
      )
      .returning({ id: schema.rankAlerts.id });
    if (!row) throw new AppError('NOT_FOUND', 'Alert not found');
  }

  async alertEvents(
    ctx: ResearchContext,
    projectId: string,
    limit = 100,
  ): Promise<RankAlertEvent[]> {
    const project = await this.projects.get(ctx.organizationId, projectId);
    const rows = await this.db
      .select({
        event: schema.rankAlertEvents,
        type: schema.rankAlerts.type,
        keyword: schema.trackedKeywords.keyword,
        device: schema.trackedKeywords.device,
      })
      .from(schema.rankAlertEvents)
      .innerJoin(schema.rankAlerts, eq(schema.rankAlerts.id, schema.rankAlertEvents.alertId))
      .innerJoin(
        schema.trackedKeywords,
        eq(schema.trackedKeywords.id, schema.rankAlertEvents.trackedKeywordId),
      )
      .where(
        and(
          eq(schema.rankAlertEvents.organizationId, ctx.organizationId),
          eq(schema.rankAlertEvents.projectId, project.id),
        ),
      )
      .orderBy(desc(schema.rankAlertEvents.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.event.id,
      alertId: r.event.alertId,
      type: r.type,
      keyword: r.keyword,
      device: r.device,
      date: r.event.date,
      previousPosition: r.event.previousPosition,
      position: r.event.position,
      notifiedAt: r.event.notifiedAt?.toISOString() ?? null,
      createdAt: r.event.createdAt.toISOString(),
    }));
  }
}
