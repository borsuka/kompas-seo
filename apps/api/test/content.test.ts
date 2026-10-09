import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema, sql } from '@seo/db';
import { insertGscRows, insertRankChecks, type GscRow } from '@seo/db/clickhouse';
import {
  briefSchema,
  calibrationSchema,
  cannibalizationSchema,
  gscPerformanceSchema,
  type ContentBrief,
} from '@seo/shared';
import { joinAsViewer, resetDb, signUpWithOrg, startApp, type TestApp } from './helpers.js';

let t: TestApp;

beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t?.close();
});
beforeEach(async () => {
  await resetDb(t.db, t.ch);
});

const DAY = 86_400_000;
const day = (ago: number) => new Date(Date.now() - ago * DAY).toISOString().slice(0, 10);

async function setup() {
  const owner = await signUpWithOrg(t.app);
  const project = await owner.agent
    .post('/api/v1/projects')
    .send({ name: 'Клиника', domain: 'moyat-zabolekar.bg' })
    .expect(201);
  return { owner, projectId: project.body.id as string };
}

describe('Content briefs', () => {
  it('creates a brief job charged up front, lists it and exports Markdown once ready', async () => {
    const { owner, projectId } = await setup();
    const before = (await owner.agent.get('/api/v1/credits').expect(200)).body.balance;
    const created = await owner.agent
      .post('/api/v1/content/briefs')
      .send({ keyword: '  Избелване на Зъби ', projectId })
      .expect(201);
    const brief = briefSchema.parse(created.body);
    expect(brief).toMatchObject({
      keyword: 'избелване на зъби',
      status: 'queued',
      locationCode: 2100,
      languageCode: 'bg',
    });
    expect(brief.jobId).not.toBeNull();
    expect(before - (await owner.agent.get('/api/v1/credits').expect(200)).body.balance).toBe(20);

    const list = await owner.agent.get('/api/v1/content/briefs').query({ projectId }).expect(200);
    expect(list.body).toMatchObject({ total: 1, items: [{ id: brief.id, status: 'queued' }] });

    await owner.agent.get(`/api/v1/content/briefs/${brief.id}/export`).expect(409);
    // The worker would fill these in (covered by the worker tests).
    const content: ContentBrief = {
      titleOptions: ['Избелване на зъби – цени и методи'],
      metaDescription: 'Методи, цени и съвети.',
      h1: 'Избелване на зъби',
      searchIntent: 'Търговско',
      wordCount: { min: 900, max: 1400 },
      outline: [{ heading: 'Методи за избелване', level: 2, points: ['Лазер', 'Шини'] }],
      keyTerms: ['лазер', 'шини'],
      questions: ['Боли ли избелването?'],
      notes: ['Добавете FAQ разметка.'],
    };
    await t.db
      .update(schema.contentBriefs)
      .set({ status: 'ready', source: 'template', brief: content })
      .where(eq(schema.contentBriefs.id, brief.id));
    const md = await owner.agent
      .get(`/api/v1/content/briefs/${brief.id}/export`)
      .query({ ui: 'bg' })
      .buffer(true)
      .expect(200);
    expect(md.headers['content-type']).toContain('text/markdown');
    expect(md.text).toContain('# Бриф за съдържание: избелване на зъби');
    expect(md.text).toContain('### Методи за избелване');
    expect(md.text).toContain('- Боли ли избелването?');

    await owner.agent.delete(`/api/v1/content/briefs/${brief.id}`).expect(204);
    await owner.agent.get(`/api/v1/content/briefs/${brief.id}`).expect(404);
  });

  it('refuses without credits (no orphan brief) and for viewers', async () => {
    const { owner } = await setup();
    await t.db.execute(
      sql`update org_credit_balances set balance = 5 where organization_id = ${owner.orgId}`,
    );
    const res = await owner.agent
      .post('/api/v1/content/briefs')
      .send({ keyword: 'зъбни импланти' })
      .expect(402);
    expect(res.body.code).toBe('INSUFFICIENT_CREDITS');
    expect((await owner.agent.get('/api/v1/content/briefs').expect(200)).body.total).toBe(0);

    const viewer = await joinAsViewer(t.app, t.db, owner);
    await viewer.agent.get('/api/v1/content/briefs').expect(200);
    await viewer.agent.post('/api/v1/content/briefs').send({ keyword: 'x' }).expect(403);
  });
});

describe('Search Console (mock provider)', () => {
  /** 28 days of rows: query A on one page, query B split between two pages. */
  async function seedGsc(projectId: string) {
    const rows: GscRow[] = [];
    for (let ago = 2; ago < 2 + 56; ago++) {
      const recent = ago < 30;
      rows.push(
        {
          date: day(ago),
          query: 'зъболекар софия',
          page: 'https://moyat-zabolekar.bg/',
          clicks: recent ? 20 : 10,
          impressions: 200,
          ctr: 0.1,
          position: 3,
        },
        {
          date: day(ago),
          query: 'избелване на зъби',
          page: 'https://moyat-zabolekar.bg/izbelvane',
          clicks: 3,
          impressions: 100,
          ctr: 0.03,
          position: 8,
        },
        {
          date: day(ago),
          query: 'избелване на зъби',
          page: 'https://moyat-zabolekar.bg/blog/izbelvane',
          clicks: 2,
          impressions: 80,
          ctr: 0.025,
          position: 11,
        },
      );
    }
    await insertGscRows(t.ch, projectId, rows, new Date());
  }

  it('connects, reports performance, cannibalization and calibration', async () => {
    const { owner, projectId } = await setup();
    const base = `/api/v1/projects/${projectId}/gsc`;
    expect((await owner.agent.get(base).expect(200)).body).toMatchObject({
      provider: 'mock',
      connected: false,
    });
    await owner.agent.get(`${base}/performance`).expect(409);

    const connect = await owner.agent.post(`${base}/connect`).expect(200);
    expect(connect.body).toEqual({ url: null });
    const status = await owner.agent.get(base).expect(200);
    expect(status.body).toMatchObject({
      connected: true,
      status: 'active',
      siteUrl: 'sc-domain:moyat-zabolekar.bg',
    });
    const [job] = await t.db.select().from(schema.jobs).where(eq(schema.jobs.type, 'gsc.sync'));
    expect(job).toBeDefined();

    await seedGsc(projectId);
    const perf = gscPerformanceSchema.parse(
      (await owner.agent.get(`${base}/performance`).query({ days: 28, by: 'query' }).expect(200))
        .body,
    );
    expect(perf.to).toBe(day(2));
    expect(perf.daily).toHaveLength(28);
    expect(perf.totals.clicks).toBe(28 * 25);
    expect(perf.previous.clicks).toBeLessThan(perf.totals.clicks);
    expect(perf.rows.map((r) => r.key)).toEqual(['зъболекар софия', 'избелване на зъби']);
    expect(perf.rows[0]).toMatchObject({ clicks: 560, impressions: 5600, ctr: 0.1, position: 3 });
    const pages = await owner.agent
      .get(`${base}/performance`)
      .query({ by: 'page', q: 'blog' })
      .expect(200);
    expect(pages.body.rows.map((r: { key: string }) => r.key)).toEqual([
      'https://moyat-zabolekar.bg/blog/izbelvane',
    ]);

    const cannibal = cannibalizationSchema.parse(
      (await owner.agent.get(`${base}/cannibalization`).expect(200)).body,
    );
    expect(cannibal.issues).toHaveLength(1);
    expect(cannibal.issues[0]).toMatchObject({ query: 'избелване на зъби', severity: 'high' });
    expect(cannibal.issues[0]!.pages).toHaveLength(2);

    // Calibration from tracked rank checks: our estimate vs real clicks.
    await insertRankChecks(t.ch, [
      {
        projectId,
        keyword: 'зъболекар софия',
        device: 'desktop',
        locationCode: 2100,
        languageCode: 'bg',
        date: day(1),
        position: 3,
        url: 'https://moyat-zabolekar.bg/',
        volume: 3000,
        serpFeatures: [],
        volatility: 0,
        topUrls: [],
        checkedAt: new Date(),
      },
    ]);
    const cal = calibrationSchema.parse(
      (await owner.agent.get(`${base}/calibration`).expect(200)).body,
    );
    expect(cal.source).toBe('rank_tracking');
    expect(cal.rows[0]).toMatchObject({
      keyword: 'зъболекар софия',
      actualClicks: expect.any(Number),
    });
    expect(cal.factor).toBeGreaterThan(0);
    expect(cal.reliable).toBe(false);

    await owner.agent.delete(base).expect(204);
    expect((await owner.agent.get(base).expect(200)).body.connected).toBe(false);
  });

  it('rejects OAuth callbacks with an unknown state', async () => {
    const { owner } = await setup();
    const res = await owner.agent
      .get('/api/v1/integrations/gsc/callback')
      .query({ code: 'x', state: 'forged' })
      .expect(302);
    expect(res.headers.location).toContain('gsc=invalid_state');
  });

  it('keeps Search Console and briefs private to the organization', async () => {
    const { owner, projectId } = await setup();
    await owner.agent.post(`/api/v1/projects/${projectId}/gsc/connect`).expect(200);
    const brief = await owner.agent
      .post('/api/v1/content/briefs')
      .send({ keyword: 'импланти' })
      .expect(201);
    const viewer = await joinAsViewer(t.app, t.db, owner);
    await viewer.agent.post(`/api/v1/projects/${projectId}/gsc/connect`).expect(403);
    await viewer.agent.delete(`/api/v1/projects/${projectId}/gsc`).expect(403);

    const b = await signUpWithOrg(t.app, 'Other');
    const base = `/api/v1/projects/${projectId}/gsc`;
    for (const path of ['', '/performance', '/cannibalization', '/calibration', '/sites'])
      await b.agent.get(`${base}${path}`).expect(404);
    await b.agent.post(`${base}/connect`).expect(404);
    await b.agent.post(`${base}/sync`).expect(404);
    await b.agent.delete(base).expect(404);
    await b.agent.get(`/api/v1/content/briefs/${brief.body.id}`).expect(404);
    await b.agent.get(`/api/v1/content/briefs/${brief.body.id}/export`).expect(404);
    await b.agent.delete(`/api/v1/content/briefs/${brief.body.id}`).expect(404);
    expect((await b.agent.get('/api/v1/content/briefs').expect(200)).body.total).toBe(0);
    expect((await owner.agent.get(base).expect(200)).body.connected).toBe(true);
  });
});
