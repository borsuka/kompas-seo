import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  GoogleAuthError,
  GoogleGscClient,
  GoogleOAuth,
  matchSite,
  MockGscClient,
  mockAccessToken,
  type GscClient,
  type GscSite,
} from '@seo/data-providers';
import { and, eq, schema, type Database } from '@seo/db';
import {
  deleteGscProject,
  gscDaily,
  gscLatestDate,
  gscQueryPages,
  gscTop,
  latestDomainKeywords,
  rankHistory,
  type ClickHouseClient,
} from '@seo/db/clickhouse';
import { calibrationFactor, detectCannibalization, expectedClicks } from '@seo/seo-core';
import {
  AppError,
  type Calibration,
  type Cannibalization,
  type GscConnection,
  type GscPerformance,
  type GscPerformanceQuery,
  type Locale,
} from '@seo/shared';
import { decryptSecret, encryptSecret } from '@seo/shared/server';
import { AuditService } from '../audit/audit.service.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { CLICKHOUSE, DB, REDIS } from '../infra/tokens.js';
import { JobsService } from '../jobs/jobs.service.js';
import type { ResearchContext } from '../keywords/keywords.service.js';
import { ProjectsService } from '../projects/projects.service.js';

const STATE_TTL_SEC = 600;
const LAG_DAYS = 2;
const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Same AAD as the worker: an encrypted token is bound to its project. */
const tokenAad = (projectId: string) => `gsc:${projectId}`;

interface OAuthState {
  organizationId: string;
  projectId: string;
  userId: string;
}

@Injectable()
export class GscService {
  private readonly logger = new Logger('GscService');
  private readonly oauth: GoogleOAuth | null;
  private readonly google: GscClient = new GoogleGscClient();
  private readonly mock: GscClient = new MockGscClient();

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLICKHOUSE) private readonly ch: ClickHouseClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly projects: ProjectsService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
  ) {
    this.oauth =
      env.GSC_PROVIDER === 'google' && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? new GoogleOAuth({
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            redirectUri: this.redirectUri,
          })
        : null;
  }

  /** Must be registered as an authorized redirect URI of the Google OAuth client. */
  get redirectUri() {
    return `${this.env.APP_URL}/api/v1/integrations/gsc/callback`;
  }

  private get provider(): 'google' | 'mock' {
    return this.env.GSC_PROVIDER;
  }

  private async connection(organizationId: string, projectId: string) {
    const [row] = await this.db
      .select()
      .from(schema.gscConnections)
      .where(
        and(
          eq(schema.gscConnections.organizationId, organizationId),
          eq(schema.gscConnections.projectId, projectId),
        ),
      );
    return row ?? null;
  }

  private async active(organizationId: string, projectId: string) {
    const conn = await this.connection(organizationId, projectId);
    if (!conn || conn.status !== 'active')
      throw new AppError('CONFLICT', 'Connect Google Search Console for this project first');
    return conn;
  }

  async status(ctx: ResearchContext, projectId: string): Promise<GscConnection> {
    const project = await this.projects.get(ctx.organizationId, projectId);
    const conn = await this.connection(ctx.organizationId, project.id);
    return {
      provider: conn ? (conn.provider as 'google' | 'mock') : this.provider,
      connected: !!conn,
      status: conn?.status ?? null,
      siteUrl: conn?.siteUrl ?? null,
      lastSyncAt: conn?.lastSyncAt?.toISOString() ?? null,
      lastError: conn?.lastError ?? null,
      dataUntil: conn ? await gscLatestDate(this.ch, project.id) : null,
    };
  }

  /** Google: returns the consent URL. Mock: connects right away. */
  async connect(ctx: ResearchContext, projectId: string): Promise<{ url: string | null }> {
    const project = await this.projects.get(ctx.organizationId, projectId);
    if (this.provider === 'mock') {
      await this.db
        .insert(schema.gscConnections)
        .values({
          organizationId: ctx.organizationId,
          projectId: project.id,
          provider: 'mock',
          status: 'active',
          siteUrl: `sc-domain:${project.domain}`,
          connectedBy: ctx.userId ?? null,
        })
        .onConflictDoUpdate({
          target: schema.gscConnections.projectId,
          set: {
            provider: 'mock',
            status: 'active',
            siteUrl: `sc-domain:${project.domain}`,
            lastError: null,
          },
        });
      await this.enqueueSync(ctx, project.id);
      return { url: null };
    }
    if (!this.oauth)
      throw new AppError(
        'PROVIDER_NOT_CONFIGURED',
        'Google OAuth (GOOGLE_CLIENT_ID/SECRET) is not configured',
      );
    const state = randomBytes(24).toString('base64url');
    const value: OAuthState = {
      organizationId: ctx.organizationId,
      projectId: project.id,
      userId: ctx.userId ?? '',
    };
    await this.redis.set(`gsc:state:${state}`, JSON.stringify(value), 'EX', STATE_TTL_SEC);
    return { url: this.oauth.authorizationUrl(state) };
  }

  /**
   * OAuth redirect target. The state (single use, 10 min) ties the callback to the user and
   * project that started it. Returns the web URL to redirect to.
   */
  async callback(
    userId: string,
    q: { code?: string; state?: string; error?: string },
  ): Promise<string> {
    const back = (params: Record<string, string>) =>
      `${this.env.APP_URL}/app/content/gsc?${new URLSearchParams(params).toString()}`;
    if (!q.state) return back({ gsc: 'invalid_state' });
    const raw = await this.redis.getdel(`gsc:state:${q.state}`);
    const state = raw ? (JSON.parse(raw) as OAuthState) : null;
    if (!state || state.userId !== userId) return back({ gsc: 'invalid_state' });
    if (q.error || !q.code) return back({ gsc: 'denied', project: state.projectId });
    if (!this.oauth) return back({ gsc: 'not_configured', project: state.projectId });

    // The project must still exist in the organization.
    const project = await this.projects.get(state.organizationId, state.projectId);
    let refreshToken: string | null;
    let sites: GscSite[];
    let scope: string;
    try {
      const tokens = await this.oauth.exchangeCode(q.code);
      refreshToken = tokens.refreshToken;
      scope = tokens.scope;
      sites = await this.google.listSites(tokens.accessToken);
    } catch (err) {
      this.logger.warn({ err }, 'Search Console OAuth exchange failed');
      return back({ gsc: 'failed', project: project.id });
    }
    if (!refreshToken) return back({ gsc: 'no_refresh_token', project: project.id });

    const site = matchSite(sites, project.domain);
    const values = {
      provider: 'google',
      status: site ? ('active' as const) : ('pending_site' as const),
      siteUrl: site?.siteUrl ?? null,
      refreshTokenEnc: encryptSecret(refreshToken, this.env.ENCRYPTION_KEY, tokenAad(project.id)),
      scope,
      lastError: null,
      connectedBy: userId,
    };
    await this.db
      .insert(schema.gscConnections)
      .values({ organizationId: state.organizationId, projectId: project.id, ...values })
      .onConflictDoUpdate({ target: schema.gscConnections.projectId, set: values });
    await this.redis.del(`gsc:at:${project.id}`);
    await this.audit.log({
      organizationId: state.organizationId,
      actorUserId: userId,
      action: 'gsc.connected',
      targetType: 'project',
      targetId: project.id,
      metadata: { siteUrl: site?.siteUrl ?? null },
    });
    if (site)
      await this.jobs.enqueue(
        'gsc.sync',
        { projectId: project.id },
        { organizationId: state.organizationId, userId },
      );
    return back({ gsc: site ? 'connected' : 'choose_site', project: project.id });
  }

  private async accessToken(conn: typeof schema.gscConnections.$inferSelect, domain: string) {
    if (conn.provider === 'mock') return mockAccessToken(domain);
    if (!this.oauth || !conn.refreshTokenEnc)
      throw new AppError('PROVIDER_NOT_CONFIGURED', 'Google Search Console is not configured');
    try {
      const tokens = await this.oauth.refresh(
        decryptSecret(conn.refreshTokenEnc, this.env.ENCRYPTION_KEY, tokenAad(conn.projectId)),
      );
      return tokens.accessToken;
    } catch (err) {
      if (err instanceof GoogleAuthError && err.code === 'invalid_grant') {
        await this.db
          .update(schema.gscConnections)
          .set({ status: 'error', lastError: 'reconnect_required' })
          .where(eq(schema.gscConnections.id, conn.id));
        throw new AppError('CONFLICT', 'Google access was revoked: reconnect Search Console');
      }
      throw err;
    }
  }

  /** Properties the connected Google account can read (to pick one). */
  async sites(ctx: ResearchContext, projectId: string): Promise<GscSite[]> {
    const project = await this.projects.get(ctx.organizationId, projectId);
    const conn = await this.connection(ctx.organizationId, project.id);
    if (!conn) throw new AppError('CONFLICT', 'Connect Google Search Console first');
    const client = conn.provider === 'mock' ? this.mock : this.google;
    const sites = await client.listSites(await this.accessToken(conn, project.domain));
    return sites.filter((s) => s.permissionLevel !== 'siteUnverifiedUser');
  }

  async selectSite(ctx: ResearchContext, projectId: string, siteUrl: string) {
    const sites = await this.sites(ctx, projectId);
    if (!sites.some((s) => s.siteUrl === siteUrl))
      throw new AppError(
        'VALIDATION_FAILED',
        'This property is not available for the connected account',
      );
    await this.db
      .update(schema.gscConnections)
      .set({ siteUrl, status: 'active', lastError: null, lastSyncAt: null })
      .where(
        and(
          eq(schema.gscConnections.organizationId, ctx.organizationId),
          eq(schema.gscConnections.projectId, projectId),
        ),
      );
    await this.enqueueSync(ctx, projectId);
    return this.status(ctx, projectId);
  }

  async disconnect(ctx: ResearchContext, projectId: string) {
    const project = await this.projects.get(ctx.organizationId, projectId);
    const conn = await this.connection(ctx.organizationId, project.id);
    if (!conn) return;
    if (conn.provider === 'google' && this.oauth && conn.refreshTokenEnc) {
      try {
        await this.oauth.revoke(
          decryptSecret(conn.refreshTokenEnc, this.env.ENCRYPTION_KEY, tokenAad(project.id)),
        );
      } catch (err) {
        this.logger.warn({ err }, 'Could not revoke the Google token');
      }
    }
    await this.db.delete(schema.gscConnections).where(eq(schema.gscConnections.id, conn.id));
    await deleteGscProject(this.ch, project.id);
    await this.audit.log({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId ?? null,
      action: 'gsc.disconnected',
      targetType: 'project',
      targetId: project.id,
    });
  }

  private enqueueSync(ctx: ResearchContext, projectId: string) {
    return this.jobs.enqueue(
      'gsc.sync',
      { projectId },
      { organizationId: ctx.organizationId, userId: ctx.userId ?? '' },
    );
  }

  async sync(ctx: ResearchContext, projectId: string) {
    const project = await this.projects.get(ctx.organizationId, projectId);
    await this.active(ctx.organizationId, project.id);
    return this.enqueueSync(ctx, project.id);
  }

  // ---------------------------------------------------------------- reports

  /** [from, to] ending at the latest day with data (or 2 days ago). */
  private async range(projectId: string, days: number) {
    const latest = await gscLatestDate(this.ch, projectId);
    const to = latest ?? isoDay(new Date(Date.now() - LAG_DAYS * DAY));
    const from = isoDay(new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * DAY));
    const prevTo = isoDay(new Date(Date.parse(`${from}T00:00:00Z`) - DAY));
    const prevFrom = isoDay(new Date(Date.parse(`${prevTo}T00:00:00Z`) - (days - 1) * DAY));
    return { from, to, prevFrom, prevTo };
  }

  async performance(
    ctx: ResearchContext,
    projectId: string,
    q: GscPerformanceQuery,
  ): Promise<GscPerformance> {
    const project = await this.projects.get(ctx.organizationId, projectId);
    await this.active(ctx.organizationId, project.id);
    const r = await this.range(project.id, q.days);
    const totals = (rows: { clicks: number; impressions: number; position: number }[]) => {
      const clicks = rows.reduce((s, d) => s + d.clicks, 0);
      const impressions = rows.reduce((s, d) => s + d.impressions, 0);
      const weighted = rows.reduce((s, d) => s + d.position * d.impressions, 0);
      return {
        clicks,
        impressions,
        ctr: impressions ? Math.round((clicks / impressions) * 10_000) / 10_000 : 0,
        position: impressions ? Math.round((weighted / impressions) * 10) / 10 : null,
      };
    };
    const daily = await gscDaily(this.ch, { project: project.id, from: r.from, to: r.to });
    const previous = await gscDaily(this.ch, {
      project: project.id,
      from: r.prevFrom,
      to: r.prevTo,
    });
    const top = await gscTop(this.ch, {
      project: project.id,
      from: r.from,
      to: r.to,
      by: q.by,
      search: q.q,
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    });
    return {
      from: r.from,
      to: r.to,
      totals: totals(daily),
      previous: totals(previous),
      daily,
      rows: top.rows,
      total: top.total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async cannibalization(
    ctx: ResearchContext,
    projectId: string,
    days: number,
  ): Promise<Cannibalization> {
    const project = await this.projects.get(ctx.organizationId, projectId);
    await this.active(ctx.organizationId, project.id);
    const r = await this.range(project.id, days);
    const rows = await gscQueryPages(this.ch, { project: project.id, from: r.from, to: r.to });
    return { from: r.from, to: r.to, issues: detectCannibalization(rows).slice(0, 500) };
  }

  /**
   * Compares our click estimates (volume × CTR at the position) with real Search Console
   * clicks for the same queries, scaled to a month, and returns the correction factor.
   */
  async calibration(ctx: ResearchContext, projectId: string, days: number): Promise<Calibration> {
    const project = await this.projects.get(ctx.organizationId, projectId);
    await this.active(ctx.organizationId, project.id);
    const r = await this.range(project.id, days);
    const actual = new Map<string, number>();
    for (const row of await gscQueryPages(this.ch, { project: project.id, from: r.from, to: r.to }))
      actual.set(row.query, (actual.get(row.query) ?? 0) + row.clicks);
    const perMonth = 30 / days;

    type Estimate = { keyword: string; position: number | null; volume: number };
    const compare = (estimates: Estimate[]) =>
      estimates
        .filter((e) => actual.has(e.keyword))
        .map((e) => ({
          keyword: e.keyword,
          position: e.position,
          volume: e.volume,
          estimatedClicks: Math.round(expectedClicks(e.position, e.volume) * 10) / 10,
          actualClicks: Math.round((actual.get(e.keyword) ?? 0) * perMonth * 10) / 10,
        }))
        .sort((a, b) => b.actualClicks - a.actualClicks);

    // Our own rank checks first; the domain's organic keyword snapshot when it overlaps more.
    const ranks = await rankHistory(this.ch, project.id, r.from);
    const latest = new Map<string, (typeof ranks)[number]>();
    for (const k of ranks) if (k.device === 'desktop') latest.set(k.keyword, k);
    const fromRanks = compare([...latest.values()]);
    const loc: Locale = {
      locationCode: project.locationCode,
      languageCode: project.languageCode as Locale['languageCode'],
    };
    const snapshot = await latestDomainKeywords(this.ch, project.domain, loc, 'live', 30);
    const fromDomain = compare(snapshot ?? []);
    const [source, rows]: [Calibration['source'], typeof fromRanks] =
      fromRanks.length >= Math.min(20, fromDomain.length) && fromRanks.length > 0
        ? ['rank_tracking', fromRanks]
        : fromDomain.length
          ? ['domain_keywords', fromDomain]
          : ['none', []];
    const cal = calibrationFactor(rows);
    return {
      from: r.from,
      to: r.to,
      factor: Math.round(cal.factor * 100) / 100,
      sampleSize: cal.sampleSize,
      reliable: cal.reliable,
      source,
      rows: rows.slice(0, 200),
    };
  }
}
