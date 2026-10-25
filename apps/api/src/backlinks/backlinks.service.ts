import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, schema, type Database } from '@seo/db';
import {
  insertBacklinkSnapshot,
  latestBacklinkSnapshot,
  type BacklinkSnapshot,
  type ClickHouseClient,
} from '@seo/db/clickhouse';
import {
  anchorDistribution,
  disavowFile,
  linkGap,
  referringDomainsByMonth,
  toxicity,
} from '@seo/seo-core';
import {
  AppError,
  can,
  normalizeDomain,
  type AddDisavowInput,
  type AnchorRowDto,
  type AnchorsQuery,
  type Backlink,
  type BacklinkOverview,
  type BacklinksListQuery,
  type DisavowEntryDto,
  type LinkGapQuery,
  type LinkGapResponse,
  type Paginated,
  type ReferringDomain,
  type ReferringDomainsQuery,
  type ToxicDomain,
  type ToxicQuery,
  type ToxicResponse,
} from '@seo/shared';
import { AuditService } from '../audit/audit.service.js';
import { CLICKHOUSE, DB } from '../infra/tokens.js';
import { STORED_MAX_DAYS } from '../domains/domains.service.js';
import type { ResearchContext } from '../keywords/keywords.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { MeteredProviders } from '../providers/metered-providers.service.js';

/** Backlink snapshots are reused for a week (matches the provider cache TTL). */
export const BACKLINK_FRESH_DAYS = 7;
/** Rows fetched per snapshot (one provider page, strongest first). */
export const BACKLINK_SAMPLE = 1000;
const NEW_DAYS = 30;
const DAY = 86_400_000;

const paginate = <T>(rows: T[], page: number, pageSize: number): Paginated<T> => ({
  items: rows.slice((page - 1) * pageSize, page * pageSize),
  page,
  pageSize,
  total: rows.length,
});

const isNew = (iso: string) => Date.now() - Date.parse(iso) <= NEW_DAYS * DAY;

function compare<T>(value: (r: T) => number | string | null, dir: 'asc' | 'desc') {
  const sign = dir === 'asc' ? 1 : -1;
  return (a: T, b: T) => {
    const x = value(a);
    const y = value(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return typeof x === 'string' ? sign * x.localeCompare(String(y)) : sign * (x - (y as number));
  };
}

@Injectable()
export class BacklinksService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLICKHOUSE) private readonly ch: ClickHouseClient,
    private readonly metered: MeteredProviders,
    private readonly projects: ProjectsService,
    private readonly audit: AuditService,
  ) {}

  private assertCanSpend(ctx: ResearchContext) {
    if (!can(ctx.role, 'research:run'))
      throw new AppError('FORBIDDEN', 'Your role cannot run new research (it spends credits)', {
        permission: 'research:run',
      });
  }

  /** Stored snapshot if fresh, otherwise summary + backlinks + referring domains fetched once. */
  async snapshot(
    ctx: ResearchContext,
    target: string,
  ): Promise<{ snap: BacklinkSnapshot; creditsCharged: number }> {
    // Read-only roles get the latest stored snapshot of any age instead of a refusal.
    const maxAge = can(ctx.role, 'research:run') ? BACKLINK_FRESH_DAYS : STORED_MAX_DAYS;
    const stored = await latestBacklinkSnapshot(this.ch, target, maxAge);
    if (stored) return { snap: stored, creditsCharged: 0 };
    this.assertCanSpend(ctx);

    const listOpts = {
      limit: BACKLINK_SAMPLE,
      offset: 0,
      status: 'all' as const,
      onePerDomain: false,
    };
    const pageOpts = { limit: BACKLINK_SAMPLE, offset: 0 };
    const creditsCharged =
      this.metered.price('backlinks', 'getBacklinkSummary', target) +
      this.metered.price('backlinks', 'getBacklinks', target, listOpts) +
      this.metered.price('backlinks', 'getReferringDomains', target, pageOpts);
    const summary = await this.metered.call(ctx, 'backlinks', 'getBacklinkSummary', target);
    const backlinks = await this.metered.call(ctx, 'backlinks', 'getBacklinks', target, listOpts);
    const referringDomains = await this.metered.call(
      ctx,
      'backlinks',
      'getReferringDomains',
      target,
      pageOpts,
    );
    const fetchedAt = new Date();
    await insertBacklinkSnapshot(
      this.ch,
      { target, fetchedAt, summary, backlinks, referringDomains },
      this.metered.providerName('backlinks'),
    );
    return {
      snap: { target, fetchedAt: fetchedAt.toISOString(), summary, backlinks, referringDomains },
      creditsCharged,
    };
  }

  // ------------------------------------------------------------ research

  async overview(ctx: ResearchContext, target: string): Promise<BacklinkOverview> {
    const { snap, creditsCharged } = await this.snapshot(ctx, target);
    const live = snap.backlinks.filter((b) => !b.lostAt);
    const anchors = anchorDistribution(live, target);
    const anchorTypes = { branded: 0, url: 0, generic: 0, empty: 0, other: 0 };
    for (const a of anchors) anchorTypes[a.type] += a.backlinks;
    const rel = { follow: 0, nofollow: 0, ugc: 0, sponsored: 0 };
    for (const b of live) rel[b.rel]++;
    const tlds = new Map<string, number>();
    for (const d of snap.referringDomains.filter((d) => !d.lostAt)) {
      const tld = d.domain.split('.').at(-1) ?? '';
      tlds.set(tld, (tlds.get(tld) ?? 0) + 1);
    }
    return {
      target,
      summary: snap.summary,
      newLost: referringDomainsByMonth(snap.referringDomains, 12),
      anchors: anchors.slice(0, 10),
      anchorTypes,
      rel,
      tlds: [...tlds.entries()]
        .map(([tld, domains]) => ({ tld, domains }))
        .sort((a, b) => b.domains - a.domains)
        .slice(0, 8),
      topReferringDomains: snap.referringDomains.filter((d) => !d.lostAt).slice(0, 10),
      sample: { backlinks: snap.backlinks.length, referringDomains: snap.referringDomains.length },
      fetchedAt: snap.fetchedAt,
      creditsCharged,
    };
  }

  async backlinks(
    ctx: ResearchContext,
    q: BacklinksListQuery,
  ): Promise<Paginated<Backlink> & { creditsCharged: number }> {
    const { snap, creditsCharged } = await this.snapshot(ctx, q.target);
    const needle = q.q?.toLowerCase();
    const rows = snap.backlinks
      .filter((b) => {
        switch (q.status) {
          case 'live':
            if (b.lostAt) return false;
            break;
          case 'lost':
            if (!b.lostAt) return false;
            break;
          case 'new':
            if (b.lostAt || !isNew(b.firstSeen)) return false;
            break;
          case 'broken':
            if (b.targetStatus === null || b.targetStatus < 400) return false;
            break;
        }
        if (q.rel && b.rel !== q.rel) return false;
        return (
          !needle ||
          b.anchor.toLowerCase().includes(needle) ||
          b.sourceUrl.toLowerCase().includes(needle)
        );
      })
      .sort(
        compare<Backlink>(
          (b) =>
            q.sort === 'rating'
              ? b.sourceRating
              : q.sort === 'spamScore'
                ? b.spamScore
                : Date.parse(q.sort === 'firstSeen' ? b.firstSeen : b.lastSeen),
          q.dir,
        ),
      );
    return { ...paginate(rows, q.page, q.pageSize), creditsCharged };
  }

  async referringDomains(
    ctx: ResearchContext,
    q: ReferringDomainsQuery,
  ): Promise<
    Paginated<ReferringDomain & { toxicity: ToxicDomain['toxicity'] }> & { creditsCharged: number }
  > {
    const { snap, creditsCharged } = await this.snapshot(ctx, q.target);
    const needle = q.q?.toLowerCase();
    const rows = snap.referringDomains
      .filter((d) => {
        if (q.status === 'live' && d.lostAt) return false;
        if (q.status === 'lost' && !d.lostAt) return false;
        if (q.status === 'new' && (d.lostAt || !isNew(d.firstSeen))) return false;
        return !needle || d.domain.includes(needle);
      })
      .sort(
        compare<ReferringDomain>(
          (d) =>
            q.sort === 'rating'
              ? d.rating
              : q.sort === 'backlinks'
                ? d.backlinks
                : q.sort === 'spamScore'
                  ? d.spamScore
                  : Date.parse(d.firstSeen),
          q.dir,
        ),
      )
      .map((d) => ({ ...d, toxicity: toxicity(d) }));
    return { ...paginate(rows, q.page, q.pageSize), creditsCharged };
  }

  async anchors(
    ctx: ResearchContext,
    q: AnchorsQuery,
  ): Promise<Paginated<AnchorRowDto> & { creditsCharged: number }> {
    const { snap, creditsCharged } = await this.snapshot(ctx, q.target);
    const needle = q.q?.toLowerCase();
    const rows = anchorDistribution(
      snap.backlinks.filter((b) => !b.lostAt),
      q.target,
    ).filter(
      (a) => (!q.type || a.type === q.type) && (!needle || a.anchor.toLowerCase().includes(needle)),
    );
    return { ...paginate(rows, q.page, q.pageSize), creditsCharged };
  }

  /** Referring domains of competitors that do not link to the target (outreach prospects). */
  async linkGap(ctx: ResearchContext, q: LinkGapQuery): Promise<LinkGapResponse> {
    const competitors = [...new Set(q.competitors)].filter((c) => c !== q.target);
    if (!competitors.length)
      throw new AppError(
        'VALIDATION_FAILED',
        'Add at least one competitor different from the target',
      );
    const domains = [q.target, ...competitors];
    const referring = new Map<string, ReferringDomain[]>();
    let creditsCharged = 0;
    for (const d of domains) {
      const { snap, creditsCharged: c } = await this.snapshot(ctx, d);
      referring.set(d, snap.referringDomains);
      creditsCharged += c;
    }
    const rows = linkGap(q.target, competitors, referring, {
      minCompetitors: q.minCompetitors,
    }).filter(
      (r) =>
        !q.hideToxic ||
        toxicity({
          domain: r.domain,
          rating: r.rating,
          spamScore: r.spamScore,
          backlinks: 1,
          dofollow: 1,
        }).level !== 'high',
    );
    return { domains, ...paginate(rows, q.page, q.pageSize), creditsCharged };
  }

  // ----------------------------------------------------- toxic & disavow

  private disavowRows(organizationId: string, projectId: string) {
    return this.db
      .select()
      .from(schema.disavowEntries)
      .where(
        and(
          eq(schema.disavowEntries.organizationId, organizationId),
          eq(schema.disavowEntries.projectId, projectId),
        ),
      )
      .orderBy(desc(schema.disavowEntries.createdAt));
  }

  async toxic(ctx: ResearchContext, projectId: string, q: ToxicQuery): Promise<ToxicResponse> {
    const project = await this.projects.get(ctx.organizationId, projectId);
    const { snap, creditsCharged } = await this.snapshot(ctx, project.domain);
    const disavowed = new Set(
      (await this.disavowRows(ctx.organizationId, project.id))
        .filter((e) => e.type === 'domain')
        .map((e) => e.value),
    );
    const scored = snap.referringDomains
      .filter((d) => !d.lostAt)
      .map((d) => ({ ...d, toxicity: toxicity(d), disavowed: disavowed.has(d.domain) }))
      .sort((a, b) => b.toxicity.score - a.toxicity.score || a.domain.localeCompare(b.domain));
    const counts = { low: 0, medium: 0, high: 0 };
    for (const d of scored) counts[d.toxicity.level]++;
    const rows = scored.filter(
      (d) =>
        (q.level === 'all' ||
          (q.level === 'high' ? d.toxicity.level === 'high' : d.toxicity.level !== 'low')) &&
        (q.disavowed === 'all' || (q.disavowed === 'yes') === d.disavowed),
    );
    return {
      domain: project.domain,
      ...paginate(rows, q.page, q.pageSize),
      counts,
      disavowed: scored.filter((d) => d.disavowed).length,
      fetchedAt: snap.fetchedAt,
      creditsCharged,
    };
  }

  async disavowList(ctx: ResearchContext, projectId: string): Promise<DisavowEntryDto[]> {
    const project = await this.projects.get(ctx.organizationId, projectId);
    return (await this.disavowRows(ctx.organizationId, project.id)).map((e) => ({
      id: e.id,
      type: e.type,
      value: e.value,
      reason: e.reason,
      createdAt: e.createdAt.toISOString(),
    }));
  }

  async addDisavow(ctx: ResearchContext, projectId: string, input: AddDisavowInput) {
    const project = await this.projects.get(ctx.organizationId, projectId);
    const values = input.entries.map((e) => {
      if (e.type === 'domain') {
        const d = normalizeDomain(e.value);
        if (!d) throw new AppError('VALIDATION_FAILED', `Invalid domain: ${e.value}`);
        return { ...e, value: d };
      }
      let url: URL;
      try {
        url = new URL(e.value);
      } catch {
        throw new AppError('VALIDATION_FAILED', `Invalid URL: ${e.value}`);
      }
      if (!/^https?:$/.test(url.protocol))
        throw new AppError('VALIDATION_FAILED', `Invalid URL: ${e.value}`);
      return { ...e, value: url.toString() };
    });
    const inserted = await this.db
      .insert(schema.disavowEntries)
      .values(
        values.map((e) => ({
          organizationId: ctx.organizationId,
          projectId: project.id,
          type: e.type,
          value: e.value,
          reason: e.reason ?? null,
          createdBy: ctx.userId ?? null,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: schema.disavowEntries.id });
    await this.audit.log({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId ?? null,
      action: 'disavow.added',
      targetType: 'project',
      targetId: project.id,
      metadata: { count: inserted.length },
    });
    return { added: inserted.length, skipped: values.length - inserted.length };
  }

  async removeDisavow(ctx: ResearchContext, projectId: string, ids: string[]) {
    const project = await this.projects.get(ctx.organizationId, projectId);
    const removed = await this.db
      .delete(schema.disavowEntries)
      .where(
        and(
          eq(schema.disavowEntries.organizationId, ctx.organizationId),
          eq(schema.disavowEntries.projectId, project.id),
          inArray(schema.disavowEntries.id, ids),
        ),
      )
      .returning({ id: schema.disavowEntries.id });
    return { removed: removed.length };
  }

  /** Google Search Console disavow file (text/plain, UTF-8). */
  async disavowExport(ctx: ResearchContext, projectId: string) {
    const project = await this.projects.get(ctx.organizationId, projectId);
    const rows = await this.disavowRows(ctx.organizationId, project.id);
    return {
      filename: `disavow-${project.domain}.txt`,
      content: disavowFile(
        rows.map((r) => ({ type: r.type, value: r.value, reason: r.reason })),
        `Disavow file for ${project.domain}\nGenerated by Kompas SEO on ${new Date().toISOString().slice(0, 10)}`,
      ),
    };
  }
}
