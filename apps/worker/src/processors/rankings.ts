import { UnrecoverableError } from 'bullmq';
import { withProviderContext } from '@seo/data-providers';
import { and, applyCreditEntry, eq, inArray, isNull, lt, or, schema, sql } from '@seo/db';
import {
  getStoredMetrics,
  insertCompetitorRanks,
  insertRankChecks,
  insertSerpSnapshot,
  previousRanks,
  rankSeriesKey,
  type CompetitorRankRow,
  type RankCheckRow,
} from '@seo/db/clickhouse';
import { alertTriggered, findDomainPosition, serpVolatility } from '@seo/seo-core';
import {
  AppError,
  computeCreditCost,
  RANK_CHECK_DEPTH,
  type Device,
  type Locale,
  type RankCheckJobInput,
  type UiLocale,
} from '@seo/shared';
import { rankAlertEmail, type RankAlertLine } from '../emails/rank-alert.js';
import type { Processor } from '../runtime.js';

/** A project is due when any of its keywords was not checked for this long. */
const CHECK_INTERVAL_HOURS = 20;
const CONCURRENCY = 8;

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Hourly: enqueues a `rankings.check` for every project with keywords that are due.
 * One check per project and day (dedupe key), so overlapping schedules are harmless.
 */
export const scheduleRankChecks: Processor<unknown, { enqueued: number }> = async (_input, ctx) => {
  const { db } = ctx.deps;
  const due = await db
    .selectDistinct({
      projectId: schema.trackedKeywords.projectId,
      organizationId: schema.trackedKeywords.organizationId,
    })
    .from(schema.trackedKeywords)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.trackedKeywords.projectId))
    .where(
      and(
        isNull(schema.projects.deletedAt),
        or(
          isNull(schema.trackedKeywords.lastCheckedAt),
          lt(
            schema.trackedKeywords.lastCheckedAt,
            sql`now() - make_interval(hours => ${CHECK_INTERVAL_HOURS})`,
          ),
        ),
      ),
    );

  let enqueued = 0;
  for (const p of due) {
    const input: RankCheckJobInput = {
      projectId: p.projectId,
      trigger: 'schedule',
      creditsCharged: 0,
    };
    const id = await ctx.deps.enqueue('rankings.check', input, {
      organizationId: p.organizationId,
      dedupeKey: `rank-check:${p.projectId}:${today()}`,
    });
    if (id) enqueued++;
  }
  ctx.logger.info({ due: due.length, enqueued }, 'rank checks scheduled');
  return { enqueued };
};

export interface RankCheckResult {
  checked: number;
  failed: number;
  creditsCharged: number;
  alerts: number;
}

/**
 * Checks the positions of a project's tracked keywords (SERP top 100), stores the history
 * of the project and its competitors, and sends alert emails. Scheduled checks are charged
 * here; manual ones were charged by the API. Failed keywords are refunded.
 */
export const checkRankings: Processor<RankCheckJobInput, RankCheckResult> = async (input, ctx) => {
  const { db, clickhouse, providers, creditCosts } = ctx.deps;
  const orgId = ctx.orgId;
  if (!orgId) throw new UnrecoverableError('rankings.check requires an organization');
  const date = today();
  const costPerKeyword = computeCreditCost(creditCosts['rank.check'], 1);
  let charged = input.creditsCharged;

  const [project] = await db
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, input.projectId),
        eq(schema.projects.organizationId, orgId),
        isNull(schema.projects.deletedAt),
      ),
    );
  if (!project) throw new UnrecoverableError('Project not found');

  const keywords = await db
    .select()
    .from(schema.trackedKeywords)
    .where(
      and(
        eq(schema.trackedKeywords.projectId, project.id),
        eq(schema.trackedKeywords.organizationId, orgId),
        input.trackedKeywordIds?.length
          ? inArray(schema.trackedKeywords.id, input.trackedKeywordIds)
          : undefined,
      ),
    );
  if (!keywords.length) return { checked: 0, failed: 0, creditsCharged: 0, alerts: 0 };

  if (input.trigger === 'schedule') {
    const cost = keywords.length * costPerKeyword;
    try {
      const res = await applyCreditEntry(db, {
        organizationId: orgId,
        delta: -cost,
        reason: 'provider_usage',
        description: `Rank check: ${keywords.length} keywords (${project.domain})`,
        refType: 'project',
        refId: project.id,
        idempotencyKey: `rank-check:${project.id}:${date}`,
      });
      // Already charged today (retry or re-run): do not charge again.
      charged = res.applied ? cost : 0;
    } catch (err) {
      if (err instanceof AppError && err.code === 'INSUFFICIENT_CREDITS')
        throw new UnrecoverableError('Not enough credits for the scheduled rank check');
      throw err;
    }
  }

  try {
    const competitors = (
      await db
        .select({ domain: schema.projectCompetitors.domain })
        .from(schema.projectCompetitors)
        .where(
          and(
            eq(schema.projectCompetitors.projectId, project.id),
            eq(schema.projectCompetitors.organizationId, orgId),
          ),
        )
    ).map((c) => c.domain);

    const previous = await previousRanks(clickhouse, project.id, date);
    const volumes = new Map<string, { volume: number; features: string[] }>();
    const byLocale = new Map<string, typeof keywords>();
    for (const k of keywords) {
      const key = `${k.locationCode}|${k.languageCode}`;
      byLocale.set(key, [...(byLocale.get(key) ?? []), k]);
    }
    for (const group of byLocale.values()) {
      const loc: Locale = {
        locationCode: group[0]!.locationCode,
        languageCode: group[0]!.languageCode as Locale['languageCode'],
      };
      const stored = await getStoredMetrics(
        clickhouse,
        [...new Set(group.map((k) => k.keyword))],
        loc,
        365,
      );
      for (const [kw, m] of stored)
        volumes.set(`${kw}|${loc.locationCode}|${loc.languageCode}`, {
          volume: m.volume,
          features: m.serpFeatures,
        });
    }

    const rankRows: RankCheckRow[] = [];
    const competitorRows: CompetitorRankRow[] = [];
    const checkedIds: string[] = [];
    let failed = 0;
    let next = 0;
    let done = 0;

    const worker = async () => {
      while (next < keywords.length) {
        const k = keywords[next++]!;
        const loc: Locale = {
          locationCode: k.locationCode,
          languageCode: k.languageCode as Locale['languageCode'],
        };
        try {
          const snap = await withProviderContext(
            { orgId, cache: 'refresh', hints: { domains: [project.domain, ...competitors] } },
            () => providers.serp.getSerp(k.keyword, loc, k.device as Device, RANK_CHECK_DEPTH),
          );
          await insertSerpSnapshot(clickhouse, snap);
          const organic = snap.items
            .filter((i) => i.type === 'organic' && i.rankGroup <= RANK_CHECK_DEPTH)
            .map((i) => ({ domain: i.domain, url: i.url, position: i.rankGroup }));
          const own = findDomainPosition(organic, project.domain);
          const topUrls = organic.slice(0, 10).map((o) => o.url ?? '');
          const series = {
            keyword: k.keyword,
            device: k.device as Device,
            locationCode: k.locationCode,
            languageCode: k.languageCode,
          };
          const prev = previous.get(rankSeriesKey(series));
          const meta = volumes.get(`${k.keyword}|${k.locationCode}|${k.languageCode}`);
          const checkedAt = new Date();
          rankRows.push({
            projectId: project.id,
            ...series,
            date,
            position: own?.position ?? null,
            url: own?.url ?? '',
            volume: meta?.volume ?? 0,
            serpFeatures: snap.features.length ? snap.features : (meta?.features ?? []),
            volatility: prev?.topUrls.length ? serpVolatility(prev.topUrls, topUrls) : 0,
            topUrls,
            checkedAt,
          });
          for (const domain of competitors) {
            const hit = findDomainPosition(organic, domain);
            competitorRows.push({
              projectId: project.id,
              ...series,
              date,
              domain,
              position: hit?.position ?? null,
              url: hit?.url ?? '',
              checkedAt,
            });
          }
          checkedIds.push(k.id);
        } catch (err) {
          failed++;
          ctx.logger.warn({ err, keyword: k.keyword }, 'rank check failed for keyword');
        }
        done++;
        if (done % 10 === 0 || done === keywords.length)
          await ctx.progress((done / keywords.length) * 90, `${done}/${keywords.length}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, keywords.length) }, worker));

    if (!checkedIds.length) throw new Error('Every keyword failed to check');
    await insertRankChecks(clickhouse, rankRows);
    await insertCompetitorRanks(clickhouse, competitorRows);
    await db
      .update(schema.trackedKeywords)
      .set({ lastCheckedAt: new Date() })
      .where(
        and(
          inArray(schema.trackedKeywords.id, checkedIds),
          eq(schema.trackedKeywords.organizationId, orgId),
        ),
      );

    if (failed > 0 && charged > 0) {
      await applyCreditEntry(db, {
        organizationId: orgId,
        delta: Math.min(charged, failed * costPerKeyword),
        reason: 'refund',
        description: `Refund: ${failed} rank checks failed`,
        refType: 'project',
        refId: project.id,
        idempotencyKey: `rank-check-partial-refund:${project.id}:${date}:${input.trigger}:${ctx.attempt}`,
      });
    }
    await ctx.progress(92, 'alerts');

    const alerts = await evaluateAlerts(ctx, {
      organizationId: orgId,
      project: { id: project.id, name: project.name },
      date,
      keywords: keywords.filter((k) => checkedIds.includes(k.id)),
      current: new Map(rankRows.map((r) => [rankSeriesKey(r), r.position])),
      previous: new Map([...previous].map(([key, r]) => [key, r.position])),
    });

    return { checked: checkedIds.length, failed, creditsCharged: charged, alerts };
  } catch (err) {
    if (ctx.isFinalAttempt && charged > 0) {
      await applyCreditEntry(db, {
        organizationId: orgId,
        delta: charged,
        reason: 'refund',
        description: 'Refund: rank check failed',
        refType: 'project',
        refId: project.id,
        idempotencyKey: `rank-check-refund:${project.id}:${date}:${input.trigger}:${ctx.attempt}`,
      });
    }
    throw err;
  }
};

/**
 * Compares each checked keyword with its previous check, records triggered alerts (once
 * per alert, keyword and day) and emails one digest per alert. Returns new events.
 */
async function evaluateAlerts(
  ctx: Parameters<Processor>[1],
  args: {
    organizationId: string;
    project: { id: string; name: string };
    date: string;
    keywords: (typeof schema.trackedKeywords.$inferSelect)[];
    current: Map<string, number | null>;
    previous: Map<string, number | null>;
  },
): Promise<number> {
  const { db, mailer, appUrl } = ctx.deps;
  const rules = await db
    .select({
      alert: schema.rankAlerts,
      locale: schema.user.locale,
    })
    .from(schema.rankAlerts)
    .leftJoin(schema.user, eq(schema.user.id, schema.rankAlerts.createdBy))
    .where(
      and(
        eq(schema.rankAlerts.projectId, args.project.id),
        eq(schema.rankAlerts.organizationId, args.organizationId),
        eq(schema.rankAlerts.enabled, true),
      ),
    );

  let total = 0;
  for (const { alert, locale } of rules) {
    const lines: (RankAlertLine & { trackedKeywordId: string })[] = [];
    for (const k of args.keywords) {
      if (alert.tag && !k.tags.includes(alert.tag)) continue;
      const key = rankSeriesKey({
        keyword: k.keyword,
        device: k.device,
        locationCode: k.locationCode,
        languageCode: k.languageCode,
      });
      // No alert on the very first check of a keyword: there is nothing to compare with.
      if (!args.previous.has(key)) continue;
      const prev = args.previous.get(key) ?? null;
      const cur = args.current.get(key) ?? null;
      if (alertTriggered({ id: alert.id, type: alert.type, threshold: alert.threshold }, prev, cur))
        lines.push({
          trackedKeywordId: k.id,
          keyword: k.keyword,
          device: k.device,
          previousPosition: prev,
          position: cur,
        });
    }
    if (!lines.length) continue;

    const inserted = await db
      .insert(schema.rankAlertEvents)
      .values(
        lines.map((l) => ({
          organizationId: args.organizationId,
          projectId: args.project.id,
          alertId: alert.id,
          trackedKeywordId: l.trackedKeywordId,
          date: args.date,
          previousPosition: l.previousPosition,
          position: l.position,
        })),
      )
      .onConflictDoNothing()
      .returning({
        id: schema.rankAlertEvents.id,
        trackedKeywordId: schema.rankAlertEvents.trackedKeywordId,
      });
    if (!inserted.length) continue;
    total += inserted.length;

    const fresh = new Set(inserted.map((e) => e.trackedKeywordId));
    const uiLocale: UiLocale = locale === 'en' ? 'en' : 'bg';
    const prefix = uiLocale === 'en' ? '/en' : '';
    try {
      await mailer.send(
        alert.emails,
        rankAlertEmail({
          locale: uiLocale,
          projectName: args.project.name,
          type: alert.type,
          threshold: alert.threshold,
          lines: lines.filter((l) => fresh.has(l.trackedKeywordId)),
          url: `${appUrl}${prefix}/app/rankings?project=${args.project.id}`,
        }),
      );
      await db
        .update(schema.rankAlertEvents)
        .set({ notifiedAt: new Date() })
        .where(
          inArray(
            schema.rankAlertEvents.id,
            inserted.map((e) => e.id),
          ),
        );
    } catch (err) {
      // Events stay without notifiedAt; they are still visible in the app.
      ctx.logger.error({ err, alertId: alert.id }, 'failed to send rank alert email');
    }
  }
  return total;
}
