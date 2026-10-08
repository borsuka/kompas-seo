import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  backlinkOverviewSchema,
  linkGapResponseSchema,
  toxicResponseSchema,
  type Backlink,
  type LinkGapRowDto,
  type ToxicDomain,
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

describe('Backlink research', () => {
  it('builds an overview from one snapshot and reuses it for a week', async () => {
    const owner = await signUpWithOrg(t.app);
    const res = await owner.agent
      .get('/api/v1/backlinks/overview')
      .query({ target: 'https://www.seo-pro.bg/' })
      .expect(200);
    const o = backlinkOverviewSchema.parse(res.body);
    expect(o.target).toBe('seo-pro.bg');
    expect(o.creditsCharged).toBeGreaterThan(0);
    expect(o.summary.referringDomains).toBeGreaterThan(0);
    expect(o.newLost).toHaveLength(12);
    expect(o.anchors.length).toBeGreaterThan(0);
    const counts = o.anchors.map((a) => a.referringDomains);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    const live = Object.values(o.rel).reduce((a, b) => a + b, 0);
    expect(Object.values(o.anchorTypes).reduce((a, b) => a + b, 0)).toBe(live);
    expect(o.anchorTypes.branded).toBeGreaterThan(0);

    const again = await owner.agent
      .get('/api/v1/backlinks/overview')
      .query({ target: 'seo-pro.bg' })
      .expect(200);
    expect(again.body.creditsCharged).toBe(0);
    expect(again.body.fetchedAt).toBe(o.fetchedAt);
  });

  it('filters backlinks, referring domains and anchors', async () => {
    const owner = await signUpWithOrg(t.app);
    const q = (path: string, query: Record<string, string | number>) =>
      owner.agent
        .get(`/api/v1/backlinks/${path}`)
        .query({ target: 'seo-pro.bg', pageSize: 500, ...query })
        .expect(200);

    const lost = await q('list', { status: 'lost' });
    expect(lost.body.items.length).toBeGreaterThan(0);
    expect(lost.body.items.every((b: Backlink) => b.lostAt !== null)).toBe(true);
    const fresh = await q('list', { status: 'new' });
    expect(
      fresh.body.items.every(
        (b: Backlink) => !b.lostAt && Date.now() - Date.parse(b.firstSeen) <= 30 * DAY,
      ),
    ).toBe(true);
    const broken = await q('list', { status: 'broken' });
    expect(broken.body.items.every((b: Backlink) => (b.targetStatus ?? 0) >= 400)).toBe(true);
    const nofollow = await q('list', { rel: 'nofollow', sort: 'rating', dir: 'desc' });
    expect(
      nofollow.body.items.every((b: Backlink) => b.rel === 'nofollow' && b.lostAt === null),
    ).toBe(true);
    const ratings = nofollow.body.items.map((b: Backlink) => b.sourceRating);
    expect([...ratings].sort((a: number, b: number) => b - a)).toEqual(ratings);

    const domains = await q('referring-domains', { status: 'live', sort: 'backlinks' });
    expect(domains.body.total).toBeGreaterThan(0);
    expect(domains.body.items[0].toxicity).toMatchObject({ level: expect.any(String) });

    const branded = await q('anchors', { type: 'branded' });
    expect(branded.body.items.length).toBeGreaterThan(0);
    expect(branded.body.items.every((a: { type: string }) => a.type === 'branded')).toBe(true);

    const csv = await owner.agent
      .get('/api/v1/backlinks/referring-domains/export')
      .query({ target: 'seo-pro.bg', format: 'csv', ui: 'en' })
      .buffer(true)
      .expect(200);
    expect(csv.text).toContain('Domain');
  });
});

describe('Acceptance: link gap', () => {
  it('returns domains linking to competitors but not to the target', async () => {
    const owner = await signUpWithOrg(t.app);
    const target = 'seo-pro.bg';
    const competitors = ['web-studio.bg', 'marketing-expert.eu'];
    const res = await owner.agent
      .get('/api/v1/backlinks/link-gap')
      .query({ target, competitors: competitors.join(','), pageSize: 500, hideToxic: 'false' })
      .expect(200);
    const gap = linkGapResponseSchema.parse(res.body);
    expect(gap.domains).toEqual([target, ...competitors]);
    expect(gap.total).toBeGreaterThan(0);

    const own = await owner.agent
      .get('/api/v1/backlinks/referring-domains')
      .query({ target, status: 'live', pageSize: 500 })
      .expect(200);
    const ownDomains = new Set(own.body.items.map((d: { domain: string }) => d.domain));
    for (const row of gap.items) {
      expect(ownDomains.has(row.domain)).toBe(false);
      expect(row.links[target]).toBe(0);
      expect(row.competitors).toBe(competitors.filter((c) => (row.links[c] ?? 0) > 0).length);
      expect(row.competitors).toBeGreaterThanOrEqual(1);
    }
    const ordered = gap.items.map((r) => r.competitors);
    expect([...ordered].sort((a, b) => b - a)).toEqual(ordered);

    const both = await owner.agent
      .get('/api/v1/backlinks/link-gap')
      .query({ target, competitors: competitors.join(','), minCompetitors: 2, pageSize: 500 })
      .expect(200);
    expect(both.body.creditsCharged).toBe(0);
    expect(both.body.items.every((r: LinkGapRowDto) => r.competitors === 2)).toBe(true);
  });
});

describe('Acceptance: toxic links and disavow', () => {
  it('scores referring domains, disavows the toxic ones and exports a Google disavow file', async () => {
    const owner = await signUpWithOrg(t.app);
    const project = await owner.agent
      .post('/api/v1/projects')
      .send({ name: 'Site', domain: 'seo-pro.bg' })
      .expect(201);
    const pid = project.body.id;

    const toxic = toxicResponseSchema.parse(
      (
        await owner.agent
          .get(`/api/v1/projects/${pid}/backlinks/toxic`)
          .query({ level: 'high', pageSize: 500 })
          .expect(200)
      ).body,
    );
    expect(toxic.counts.high).toBeGreaterThan(0);
    expect(
      toxic.items.every((d) => d.toxicity.level === 'high' && d.toxicity.reasons.length > 0),
    ).toBe(true);
    expect(toxic.counts.low).toBeGreaterThan(toxic.counts.high);

    await owner.agent
      .post(`/api/v1/projects/${pid}/disavow`)
      .send({ entries: [{ type: 'domain', value: 'not a domain' }] })
      .expect(400);
    const added = await owner.agent
      .post(`/api/v1/projects/${pid}/disavow`)
      .send({
        entries: [
          ...toxic.items.map((d) => ({ type: 'domain', value: d.domain, reason: 'Toxic' })),
          { type: 'url', value: 'https://spam.example/page' },
          { type: 'domain', value: `www.${toxic.items[0]!.domain}` },
        ],
      })
      .expect(201);
    expect(added.body).toEqual({ added: toxic.items.length + 1, skipped: 1 });

    const after = await owner.agent
      .get(`/api/v1/projects/${pid}/backlinks/toxic`)
      .query({ level: 'high', disavowed: 'no' })
      .expect(200);
    expect(after.body.total).toBe(0);
    expect(after.body.disavowed).toBe(toxic.items.length);

    const file = await owner.agent
      .get(`/api/v1/projects/${pid}/disavow/export`)
      .buffer(true)
      .expect(200);
    expect(file.headers['content-type']).toContain('text/plain');
    expect(file.text).toContain(`domain:${toxic.items[0]!.domain}`);
    expect(file.text).toContain('https://spam.example/page');
    expect(file.text.split('\n')[0]).toMatch(/^# Disavow file for seo-pro\.bg/);

    const list = await owner.agent.get(`/api/v1/projects/${pid}/disavow`).expect(200);
    const removed = await owner.agent
      .post(`/api/v1/projects/${pid}/disavow/remove`)
      .send({ ids: [list.body[0].id] })
      .expect(200);
    expect(removed.body.removed).toBe(1);
    const restored = await owner.agent
      .get(`/api/v1/projects/${pid}/backlinks/toxic`)
      .query({ level: 'all', pageSize: 500 })
      .expect(200);
    expect(restored.body.items.some((d: ToxicDomain) => d.toxicity.level === 'low')).toBe(true);
  });
});

describe('Backlink permissions and isolation', () => {
  it('viewers read stored data but cannot run new research or change the disavow list', async () => {
    const owner = await signUpWithOrg(t.app);
    const project = await owner.agent
      .post('/api/v1/projects')
      .send({ name: 'Site', domain: 'seo-pro.bg' })
      .expect(201);
    await owner.agent.get(`/api/v1/projects/${project.body.id}/backlinks/toxic`).expect(200);
    const viewer = await joinAsViewer(t.app, t.db, owner);
    await viewer.agent.get(`/api/v1/projects/${project.body.id}/backlinks/toxic`).expect(200);
    await viewer.agent
      .get('/api/v1/backlinks/overview')
      .query({ target: 'seo-pro.bg' })
      .expect(200);
    // A new target would spend credits.
    await viewer.agent
      .get('/api/v1/backlinks/overview')
      .query({ target: 'other-site.bg' })
      .expect(403);
    await viewer.agent
      .post(`/api/v1/projects/${project.body.id}/disavow`)
      .send({ entries: [{ type: 'domain', value: 'spam.xyz' }] })
      .expect(403);
  });

  it('another organization gets 404 for project backlink endpoints', async () => {
    const a = await signUpWithOrg(t.app, 'A');
    const project = await a.agent
      .post('/api/v1/projects')
      .send({ name: 'A', domain: 'a-site.bg' })
      .expect(201);
    await a.agent
      .post(`/api/v1/projects/${project.body.id}/disavow`)
      .send({ entries: [{ type: 'domain', value: 'spam.xyz' }] })
      .expect(201);
    const entry = (await a.agent.get(`/api/v1/projects/${project.body.id}/disavow`).expect(200))
      .body[0];

    const b = await signUpWithOrg(t.app, 'B');
    const base = `/api/v1/projects/${project.body.id}`;
    await b.agent.get(`${base}/backlinks/toxic`).expect(404);
    await b.agent.get(`${base}/disavow`).expect(404);
    await b.agent.get(`${base}/disavow/export`).expect(404);
    await b.agent
      .post(`${base}/disavow`)
      .send({ entries: [{ type: 'domain', value: 'x.bg' }] })
      .expect(404);
    await b.agent
      .post(`${base}/disavow/remove`)
      .send({ ids: [entry.id] })
      .expect(404);
    expect((await a.agent.get(`${base}/disavow`).expect(200)).body).toHaveLength(1);
  });
});
