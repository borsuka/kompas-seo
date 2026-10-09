import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { extractPage, type Crawler } from '@seo/crawler';
import { GoogleAuthError, type GoogleOAuth } from '@seo/data-providers';
import { applyCreditEntry, eq, getCreditBalance, schema, type Database } from '@seo/db';
import { gscDaily, type ClickHouseClient } from '@seo/db/clickhouse';
import { truncateAll } from '@seo/db/testing';
import { DisabledLLMProvider, type LLMProvider } from '@seo/llm';
import type { ContentBrief } from '@seo/shared';
import { encryptSecret } from '@seo/shared/server';
import { makeContext, setupTestDatabases } from '../testing.js';
import { buildBrief } from './content.js';
import { gscTokenAad, scheduleGsc, syncGsc } from './gsc.js';

let db: Database;
let ch: ClickHouseClient;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, ch, close } = await setupTestDatabases('seo_worker_content_test'));
}, 120_000);
beforeEach(async () => {
  await truncateAll(db);
  for (const t of ['serp_snapshots', 'gsc_daily'])
    await ch.command({ query: 'TRUNCATE TABLE IF EXISTS ' + t });
});
afterAll(async () => {
  await close?.();
});

async function seedOrg() {
  const orgId = randomUUID();
  await db.insert(schema.organization).values({ id: orgId, name: 'Org', slug: orgId });
  const [project] = await db
    .insert(schema.projects)
    .values({
      organizationId: orgId,
      name: 'Site',
      domain: 'seo-pro.bg',
      locationCode: 2100,
      languageCode: 'bg',
    })
    .returning();
  return { orgId, projectId: project!.id };
}

/** Pretends every ranking page is reachable; the 3rd one is blocked by robots.txt. */
const fakeCrawler = {
  crawl: async (url: string) => {
    if (url.includes('/', 8) && url.endsWith('3'))
      return { ok: false as const, url, reason: 'robots' as const };
    const html = `<html><head><title>Избелване на зъби | ${new URL(url).hostname}</title></head><body><main>
      <h1>Избелване на зъби</h1><h2>Цени на избелването</h2><h2>Как протича процедурата</h2>
      <p>Избелване с лазер и домашно избелване с шини. Чувствителност на зъбите след процедурата.</p>
    </main></body></html>`;
    return { ok: true as const, page: extractPage(html, url), status: 200, finalUrl: url };
  },
} as unknown as Crawler;

describe('content.brief', () => {
  async function seedBrief() {
    const { orgId, projectId } = await seedOrg();
    const [brief] = await db
      .insert(schema.contentBriefs)
      .values({
        organizationId: orgId,
        projectId,
        keyword: 'избелване на зъби',
        locationCode: 2100,
        languageCode: 'bg',
      })
      .returning();
    return { orgId, briefId: brief!.id };
  }

  it('analyzes the top 10 and writes a template brief without an LLM', async () => {
    const { orgId, briefId } = await seedBrief();
    const { ctx } = makeContext({ db, ch }, orgId, {
      crawler: fakeCrawler,
      llm: new DisabledLLMProvider(),
    });
    const res = await buildBrief({ briefId, creditsCharged: 20 }, ctx);
    expect(res.source).toBe('template');
    const [row] = await db
      .select()
      .from(schema.contentBriefs)
      .where(eq(schema.contentBriefs.id, briefId));
    expect(row).toMatchObject({ status: 'ready', source: 'template', error: null });
    const pages = row!.pages as { skipped: string | null }[];
    expect(pages.length).toBeGreaterThanOrEqual(8);
    expect(pages.filter((p) => p.skipped === 'robots').length).toBeLessThanOrEqual(1);
    expect((row!.analysis as { pagesAnalyzed: number }).pagesAnalyzed).toBe(res.pagesAnalyzed);
    const brief = row!.brief as ContentBrief;
    expect(brief.h1).toBe('Избелване на зъби');
    expect(brief.outline.map((o) => o.heading)).toContain('Цени на избелването');
  });

  it('uses the AI brief when the LLM answers', async () => {
    const { orgId, briefId } = await seedBrief();
    const aiBrief: ContentBrief = {
      titleOptions: ['Избелване на зъби – цени 2026'],
      metaDescription: 'Всичко за избелването.',
      h1: 'Избелване на зъби',
      searchIntent: 'Търговско',
      wordCount: { min: 900, max: 1300 },
      outline: [{ heading: 'Методи', level: 2, points: ['Лазер', 'Шини'] }],
      keyTerms: ['лазер'],
      questions: [],
      notes: [],
    };
    const inputs: unknown[] = [];
    const llm: LLMProvider = {
      enabled: true,
      classifyIntents: async () => new Map(),
      generateBrief: async (input) => (inputs.push(input), aiBrief),
    };
    const { ctx } = makeContext({ db, ch }, orgId, { crawler: fakeCrawler, llm });
    expect((await buildBrief({ briefId, creditsCharged: 0 }, ctx)).source).toBe('ai');
    expect(inputs[0]).toMatchObject({ keyword: 'избелване на зъби', language: 'bg' });
    const [row] = await db
      .select()
      .from(schema.contentBriefs)
      .where(eq(schema.contentBriefs.id, briefId));
    expect(row!.brief).toEqual(aiBrief);
  });

  it('marks the brief failed and refunds on the final attempt', async () => {
    const { orgId, briefId } = await seedBrief();
    await applyCreditEntry(db, { organizationId: orgId, delta: 30, reason: 'manual_adjustment' });
    await applyCreditEntry(db, { organizationId: orgId, delta: -20, reason: 'provider_usage' });
    const broken = { crawl: async () => Promise.reject(new Error('boom')) } as unknown as Crawler;
    const { ctx } = makeContext({ db, ch }, orgId, { crawler: broken });
    await expect(buildBrief({ briefId, creditsCharged: 20 }, ctx)).rejects.toThrow('boom');
    const [row] = await db
      .select()
      .from(schema.contentBriefs)
      .where(eq(schema.contentBriefs.id, briefId));
    expect(row).toMatchObject({ status: 'failed', error: 'boom' });
    expect(await getCreditBalance(db, orgId)).toBe(30);
  });
});

describe('gsc.sync', () => {
  it('pulls 90 days on the first sync and re-syncs the last week afterwards', async () => {
    const { orgId, projectId } = await seedOrg();
    await db.insert(schema.gscConnections).values({
      organizationId: orgId,
      projectId,
      provider: 'mock',
      status: 'active',
      siteUrl: 'sc-domain:seo-pro.bg',
    });
    const { ctx } = makeContext({ db, ch }, orgId);
    const first = await syncGsc({ projectId }, ctx);
    expect(first.days).toBe(90);
    expect(first.rows).toBeGreaterThan(1000);
    const daily = await gscDaily(ch, { project: projectId, from: '2000-01-01', to: '2100-01-01' });
    expect(daily).toHaveLength(90);
    expect(daily.every((d) => d.clicks <= d.impressions)).toBe(true);

    const second = await syncGsc({ projectId }, ctx);
    expect(second.days).toBe(7);
    // Re-synced days replace the old rows (FINAL), totals stay the same.
    const again = await gscDaily(ch, { project: projectId, from: '2000-01-01', to: '2100-01-01' });
    expect(again).toEqual(daily);
  }, 120_000);

  it('marks a Google connection for reconnect when the refresh token is revoked', async () => {
    const { orgId, projectId } = await seedOrg();
    const key = Buffer.alloc(32, 7).toString('base64');
    await db.insert(schema.gscConnections).values({
      organizationId: orgId,
      projectId,
      provider: 'google',
      status: 'active',
      siteUrl: 'sc-domain:seo-pro.bg',
      refreshTokenEnc: encryptSecret('refresh-token', key, gscTokenAad(projectId)),
    });
    const refreshed: string[] = [];
    const oauth = {
      refresh: async (token: string) => {
        refreshed.push(token);
        throw new GoogleAuthError('revoked', 'invalid_grant');
      },
    } as unknown as GoogleOAuth;
    const { ctx } = makeContext({ db, ch }, orgId);
    ctx.deps.gsc = { ...ctx.deps.gsc, oauth };
    expect(await syncGsc({ projectId }, ctx)).toEqual({ days: 0, rows: 0 });
    expect(refreshed).toEqual(['refresh-token']);
    const [conn] = await db
      .select()
      .from(schema.gscConnections)
      .where(eq(schema.gscConnections.projectId, projectId));
    expect(conn).toMatchObject({ status: 'error', lastError: 'reconnect_required' });
  });

  it('schedules one daily sync per active connection', async () => {
    const { orgId, projectId } = await seedOrg();
    await db.insert(schema.gscConnections).values({
      organizationId: orgId,
      projectId,
      provider: 'mock',
      status: 'active',
      siteUrl: 'x',
    });
    const other = await seedOrg();
    await db.insert(schema.gscConnections).values({
      organizationId: other.orgId,
      projectId: other.projectId,
      provider: 'mock',
      status: 'pending_site',
    });
    const { ctx, effects } = makeContext({ db, ch }, null);
    expect(await scheduleGsc({}, ctx)).toEqual({ enqueued: 1 });
    expect(effects.enqueued[0]).toMatchObject({ type: 'gsc.sync', input: { projectId } });
  });
});
