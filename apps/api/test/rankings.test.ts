import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertCompetitorRanks, insertRankChecks } from '@seo/db/clickhouse';
import {
  rankingsResponseSchema,
  rankingsSummarySchema,
  type Device,
  type TrackedKeywordRow,
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

const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const owner = await signUpWithOrg(t.app);
  const project = await owner.agent
    .post('/api/v1/projects')
    .send({ name: 'Клиника', domain: 'moyat-zabolekar.bg' })
    .expect(201);
  await owner.agent
    .post(`/api/v1/projects/${project.body.id}/competitors`)
    .send({ domain: 'rival-dent.bg' })
    .expect(201);
  return { owner, projectId: project.body.id as string };
}

/** Seeds checks: keyword → positions per day offset (oldest first). */
async function seedHistory(
  projectId: string,
  series: Record<string, (number | null)[]>,
  competitor: Record<string, (number | null)[]> = {},
  device: Device = 'desktop',
) {
  for (const [keyword, positions] of Object.entries(series)) {
    await insertRankChecks(
      t.ch,
      positions.map((position, i) => {
        const ago = positions.length - 1 - i;
        return {
          projectId,
          keyword,
          device,
          locationCode: 2100,
          languageCode: 'bg',
          date: day(ago),
          position,
          url: position === null ? '' : `https://moyat-zabolekar.bg/${encodeURIComponent(keyword)}`,
          volume: 1000,
          serpFeatures: ['local_pack'],
          volatility: i === 0 ? 0 : 2,
          topUrls: [],
          checkedAt: new Date(Date.now() - ago * 86_400_000),
        };
      }),
    );
    const comp = competitor[keyword] ?? [];
    await insertCompetitorRanks(
      t.ch,
      comp.map((position, i) => {
        const ago = comp.length - 1 - i;
        return {
          projectId,
          keyword,
          device,
          locationCode: 2100,
          languageCode: 'bg',
          date: day(ago),
          domain: 'rival-dent.bg',
          position,
          url: '',
          checkedAt: new Date(Date.now() - ago * 86_400_000),
        };
      }),
    );
  }
}

describe('Tracked keywords', () => {
  it('adds keywords per device, charges metrics + first check and skips duplicates', async () => {
    const { owner, projectId } = await setup();
    const before = (await owner.agent.get('/api/v1/credits').expect(200)).body.balance;
    const res = await owner.agent
      .post(`/api/v1/projects/${projectId}/rankings/keywords`)
      .send({
        keywords: ['Зъболекар  София', 'избелване на зъби', 'зъбни импланти'],
        devices: ['desktop', 'mobile'],
        tags: ['core'],
      })
      .expect(201);
    expect(res.body).toMatchObject({ added: 6, skipped: 0 });
    expect(res.body.job).toMatchObject({ type: 'rankings.check', status: 'queued' });
    const after = (await owner.agent.get('/api/v1/credits').expect(200)).body.balance;
    expect(before - after).toBe(res.body.creditsCharged);
    expect(res.body.creditsCharged).toBeGreaterThanOrEqual(6);

    const again = await owner.agent
      .post(`/api/v1/projects/${projectId}/rankings/keywords`)
      .send({ keywords: ['зъболекар софия'], devices: ['desktop'] })
      .expect(201);
    expect(again.body).toMatchObject({ added: 0, skipped: 1, creditsCharged: 0, job: null });

    const list = rankingsResponseSchema.parse(
      (await owner.agent.get(`/api/v1/projects/${projectId}/rankings`).expect(200)).body,
    );
    expect(list.total).toBe(6);
    expect(list.tags).toEqual(['core']);
    expect(list.competitors).toEqual(['rival-dent.bg']);
    expect(list.limit).toEqual({ used: 6, max: 50 });
    // Normalized keyword, not checked yet.
    const row = list.items.find((r) => r.keyword === 'зъболекар софия' && r.device === 'desktop')!;
    expect(row).toMatchObject({ position: null, lastCheckedAt: null, history: [] });
    expect(row.volume).toBeGreaterThan(0);

    const removed = await owner.agent
      .post(`/api/v1/projects/${projectId}/rankings/keywords/remove`)
      .send({ ids: list.items.filter((r) => r.device === 'mobile').map((r) => r.id) })
      .expect(200);
    expect(removed.body.removed).toBe(3);
    await owner.agent
      .patch(`/api/v1/projects/${projectId}/rankings/keywords/${row.id}`)
      .send({ tags: ['brand', 'core'] })
      .expect(204);
    const tagged = await owner.agent
      .get(`/api/v1/projects/${projectId}/rankings`)
      .query({ tag: 'brand' })
      .expect(200);
    expect(tagged.body.items.map((r: TrackedKeywordRow) => r.id)).toEqual([row.id]);
  });

  it('enforces the plan limit of tracked keywords', async () => {
    const { owner, projectId } = await setup();
    const keywords = Array.from({ length: 51 }, (_, i) => `ключова дума ${i}`);
    const res = await owner.agent
      .post(`/api/v1/projects/${projectId}/rankings/keywords`)
      .send({ keywords })
      .expect(403);
    expect(res.body).toMatchObject({ code: 'PLAN_LIMIT_REACHED', details: { limit: 50 } });
  });

  it('starts a manual re-check charged per keyword, 402 without credits', async () => {
    const { owner, projectId } = await setup();
    await owner.agent.post(`/api/v1/projects/${projectId}/rankings/check`).expect(400);
    await owner.agent
      .post(`/api/v1/projects/${projectId}/rankings/keywords`)
      .send({ keywords: ['зъболекар софия', 'брекети цена'] })
      .expect(201);
    const before = (await owner.agent.get('/api/v1/credits').expect(200)).body.balance;
    const job = await owner.agent.post(`/api/v1/projects/${projectId}/rankings/check`).expect(201);
    expect(job.body.type).toBe('rankings.check');
    const after = (await owner.agent.get('/api/v1/credits').expect(200)).body.balance;
    expect(before - after).toBe(2);

    await t.db.execute(
      (await import('@seo/db'))
        .sql`update org_credit_balances set balance = 1 where organization_id = ${owner.orgId}`,
    );
    const broke = await owner.agent
      .post(`/api/v1/projects/${projectId}/rankings/check`)
      .expect(402);
    expect(broke.body.code).toBe('INSUFFICIENT_CREDITS');
  });
});

describe('Acceptance: history, visibility, share of voice and movers', () => {
  it('reports positions, changes, best, sparkline, summary trend and competitors', async () => {
    const { owner, projectId } = await setup();
    await owner.agent
      .post(`/api/v1/projects/${projectId}/rankings/keywords`)
      .send({ keywords: ['зъболекар софия', 'избелване на зъби', 'зъбни импланти'] })
      .expect(201);
    // 8 daily checks (oldest first). Today is the last value.
    await seedHistory(
      projectId,
      {
        'зъболекар софия': [12, 11, 10, 9, 8, 6, 5, 3],
        'избелване на зъби': [4, 4, 5, 5, 6, 6, 7, 9],
        'зъбни импланти': [null, null, null, null, null, null, null, 15],
      },
      {
        'зъболекар софия': [1, 1, 1, 1, 1, 1, 2, 2],
        'избелване на зъби': [2, 2, 2, 2, 2, 2, 2, 1],
      },
    );

    const list = rankingsResponseSchema.parse(
      (
        await owner.agent
          .get(`/api/v1/projects/${projectId}/rankings`)
          .query({ sort: 'position', dir: 'asc' })
          .expect(200)
      ).body,
    );
    const by = Object.fromEntries(list.items.map((r) => [r.keyword, r]));
    expect(by['зъболекар софия']).toMatchObject({
      position: 3,
      previousPosition: 5,
      change1d: 2,
      change7d: 9,
      best: 3,
      competitors: { 'rival-dent.bg': 2 },
    });
    expect(by['зъболекар софия']!.history).toEqual([12, 11, 10, 9, 8, 6, 5, 3]);
    expect(by['избелване на зъби']).toMatchObject({ position: 9, change1d: -2, best: 4 });
    expect(by['зъбни импланти']).toMatchObject({
      position: 15,
      previousPosition: null,
      change1d: null,
    });
    expect(list.items.map((r) => r.position)).toEqual([3, 9, 15]);

    const up = await owner.agent
      .get(`/api/v1/projects/${projectId}/rankings`)
      .query({ changes: 'up' })
      .expect(200);
    expect(up.body.items.map((r: TrackedKeywordRow) => r.keyword)).toEqual(['зъболекар софия']);
    const fresh = await owner.agent
      .get(`/api/v1/projects/${projectId}/rankings`)
      .query({ changes: 'new' })
      .expect(200);
    expect(fresh.body.items.map((r: TrackedKeywordRow) => r.keyword)).toEqual(['зъбни импланти']);

    const summary = rankingsSummarySchema.parse(
      (await owner.agent.get(`/api/v1/projects/${projectId}/rankings/summary`).expect(200)).body,
    );
    expect(summary).toMatchObject({ keywords: 3, ranked: 3, improved: 2, declined: 1 });
    expect(summary.avgPosition).toBe(9);
    expect(summary.distribution).toMatchObject({ top3: 1, top10: 2, top20: 3, notRanked: 0 });
    expect(summary.trend).toHaveLength(8);
    expect(summary.trend.at(-1)!.volatility).toBe(2);
    expect(summary.visibility).toBeGreaterThan(0);
    expect(summary.visibilityChange).not.toBeNull();
    expect(summary.movers.up[0]).toMatchObject({ keyword: 'зъбни импланти', change: 86 });
    expect(summary.movers.down[0]).toMatchObject({ keyword: 'избелване на зъби', change: -2 });
    // Competitor ranks #1-2 for the head terms → larger share of voice.
    const sov = Object.fromEntries(summary.shareOfVoice.map((s) => [s.domain, s.share]));
    expect(sov['rival-dent.bg']).toBeGreaterThan(sov['moyat-zabolekar.bg']!);
    expect(summary.shareOfVoice.find((s) => s.isProject)!.domain).toBe('moyat-zabolekar.bg');
    expect(summary.sovTrend).toHaveLength(8);

    const id = by['зъболекар софия']!.id;
    const history = await owner.agent
      .get(`/api/v1/projects/${projectId}/rankings/keywords/${id}/history`)
      .expect(200);
    expect(history.body.points.map((p: { position: number }) => p.position)).toEqual([
      12, 11, 10, 9, 8, 6, 5, 3,
    ]);
    expect(history.body.competitors[0]).toMatchObject({ domain: 'rival-dent.bg' });
  });
});

describe('Rank alerts', () => {
  it('creates, updates, lists and deletes alert rules with validation', async () => {
    const { owner, projectId } = await setup();
    await owner.agent
      .post(`/api/v1/projects/${projectId}/rankings/alerts`)
      .send({ type: 'position_drop', threshold: 3, emails: ['not-an-email'] })
      .expect(400);
    const created = await owner.agent
      .post(`/api/v1/projects/${projectId}/rankings/alerts`)
      .send({
        type: 'position_drop',
        threshold: 3,
        emails: ['SEO@Example.test', 'seo@example.test'],
      })
      .expect(201);
    expect(created.body).toMatchObject({
      type: 'position_drop',
      threshold: 3,
      emails: ['seo@example.test'],
      enabled: true,
    });
    const updated = await owner.agent
      .patch(`/api/v1/projects/${projectId}/rankings/alerts/${created.body.id}`)
      .send({ enabled: false, tag: 'core' })
      .expect(200);
    expect(updated.body).toMatchObject({ enabled: false, tag: 'core' });
    const list = await owner.agent.get(`/api/v1/projects/${projectId}/rankings/alerts`).expect(200);
    expect(list.body).toHaveLength(1);
    await owner.agent.get(`/api/v1/projects/${projectId}/rankings/alert-events`).expect(200);
    await owner.agent
      .delete(`/api/v1/projects/${projectId}/rankings/alerts/${created.body.id}`)
      .expect(204);
    await owner.agent
      .delete(`/api/v1/projects/${projectId}/rankings/alerts/${created.body.id}`)
      .expect(404);
  });
});

describe('Rank tracking permissions and isolation', () => {
  it('viewers can read rankings but not change them or start checks', async () => {
    const { owner, projectId } = await setup();
    const viewer = await joinAsViewer(t.app, t.db, owner);
    await viewer.agent.get(`/api/v1/projects/${projectId}/rankings`).expect(200);
    await viewer.agent.get(`/api/v1/projects/${projectId}/rankings/summary`).expect(200);
    await viewer.agent
      .post(`/api/v1/projects/${projectId}/rankings/keywords`)
      .send({ keywords: ['x'] })
      .expect(403);
    await viewer.agent.post(`/api/v1/projects/${projectId}/rankings/check`).expect(403);
    await viewer.agent
      .post(`/api/v1/projects/${projectId}/rankings/alerts`)
      .send({ type: 'enter_top', threshold: 10, emails: ['v@example.test'] })
      .expect(403);
  });

  it('another organization gets 404 for every rank tracking endpoint', async () => {
    const { owner, projectId } = await setup();
    const added = await owner.agent
      .post(`/api/v1/projects/${projectId}/rankings/keywords`)
      .send({ keywords: ['зъболекар софия'] })
      .expect(201);
    const kw = (await owner.agent.get(`/api/v1/projects/${projectId}/rankings`).expect(200)).body
      .items[0];
    const alert = await owner.agent
      .post(`/api/v1/projects/${projectId}/rankings/alerts`)
      .send({ type: 'enter_top', threshold: 3, emails: ['a@example.test'] })
      .expect(201);
    expect(added.body.added).toBe(1);

    const b = await signUpWithOrg(t.app, 'Other');
    const base = `/api/v1/projects/${projectId}/rankings`;
    await b.agent.get(base).expect(404);
    await b.agent.get(`${base}/summary`).expect(404);
    await b.agent
      .post(`${base}/keywords`)
      .send({ keywords: ['x'] })
      .expect(404);
    await b.agent
      .post(`${base}/keywords/remove`)
      .send({ ids: [kw.id] })
      .expect(404);
    await b.agent
      .patch(`${base}/keywords/${kw.id}`)
      .send({ tags: ['x'] })
      .expect(404);
    await b.agent.get(`${base}/keywords/${kw.id}/history`).expect(404);
    await b.agent.post(`${base}/check`).expect(404);
    await b.agent.get(`${base}/alerts`).expect(404);
    await b.agent.patch(`${base}/alerts/${alert.body.id}`).send({ enabled: false }).expect(404);
    await b.agent.delete(`${base}/alerts/${alert.body.id}`).expect(404);
    await b.agent.get(`${base}/alert-events`).expect(404);

    // Org A's data is untouched
    const still = await owner.agent.get(base).expect(200);
    expect(still.body.total).toBe(1);
    expect((await owner.agent.get(`${base}/alerts`).expect(200)).body[0].enabled).toBe(true);
  });
});
