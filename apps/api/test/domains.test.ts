import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  competitorDiscoverySchema,
  domainOverviewResponseSchema,
  GAP_TABS,
  keywordGapResponseSchema,
  type GapTab,
  type KeywordGapRow,
} from '@seo/shared';
import { resetDb, signUpWithOrg, startApp, type TestApp } from './helpers.js';

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

describe('Domain Overview', () => {
  it('returns traffic, keyword buckets, rating, history, countries, top keywords and pages', async () => {
    const owner = await signUpWithOrg(t.app);
    const res = await owner.agent
      .get('/api/v1/domains/overview')
      .query({ domain: 'https://www.example.bg/' })
      .expect(200);
    const o = domainOverviewResponseSchema.parse(res.body);
    expect(o.domain).toBe('example.bg');
    expect(o.top3).toBeLessThanOrEqual(o.top10);
    expect(o.top10).toBeLessThanOrEqual(o.top100);
    expect(o.estTraffic).toBeGreaterThan(0);
    expect(o.rating).not.toBeNull();
    expect(o.history).toHaveLength(12);
    expect(o.countries[0]!.locationCode).toBe(2100);
    expect(o.topKeywords.length).toBeGreaterThan(0);
    const traffic = o.topKeywords.map((k) => k.traffic);
    expect([...traffic].sort((a, b) => b - a)).toEqual(traffic);
    expect(o.topPages.length).toBeGreaterThan(0);
    expect(o.creditsCharged).toBeGreaterThan(0);

    // Snapshot reused: no new charge within a week
    const again = await owner.agent
      .get('/api/v1/domains/overview')
      .query({ domain: 'example.bg' })
      .expect(200);
    expect(again.body.creditsCharged).toBe(0);
    expect(again.body.estTraffic).toBe(o.estTraffic);
  });

  it('lists domain keywords with filters, sorting and new/lost changes', async () => {
    const owner = await signUpWithOrg(t.app);
    const top10 = await owner.agent
      .get('/api/v1/domains/keywords')
      .query({ domain: 'example.bg', maxPosition: 10, sort: 'position', dir: 'asc', pageSize: 500 })
      .expect(200);
    expect(top10.body.items.every((r: { position: number }) => r.position <= 10)).toBe(true);
    const positions = top10.body.items.map((r: { position: number }) => r.position);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    const fresh = await owner.agent
      .get('/api/v1/domains/keywords')
      .query({ domain: 'example.bg', changes: 'new' })
      .expect(200);
    expect(
      fresh.body.items.every(
        (r: { previousPosition: number | null }) => r.previousPosition === null,
      ),
    ).toBe(true);

    const lost = await owner.agent
      .get('/api/v1/domains/keywords')
      .query({ domain: 'example.bg', changes: 'lost' })
      .expect(200);
    expect(lost.body.total).toBeGreaterThan(0);

    const pages = await owner.agent
      .get('/api/v1/domains/pages')
      .query({ domain: 'example.bg' })
      .expect(200);
    expect(pages.body.items[0]).toMatchObject({
      url: expect.stringContaining('example.bg'),
      keywords: expect.any(Number),
    });
  });
});

describe('Competitor discovery', () => {
  it('finds organic competitors of a project ordered by competition level, excluding universal domains', async () => {
    const owner = await signUpWithOrg(t.app);
    const project = await owner.agent
      .post('/api/v1/projects')
      .send({ name: 'Shop', domain: 'obuvki-shop.bg' })
      .expect(201);
    const res = await owner.agent
      .get(`/api/v1/projects/${project.body.id}/competitors/discover`)
      .expect(200);
    const d = competitorDiscoverySchema.parse(res.body);
    expect(d.keywordsAnalyzed).toBeGreaterThan(0);
    expect(d.competitors.length).toBeGreaterThan(0);
    const domains = d.competitors.map((c) => c.domain);
    expect(domains).not.toContain('obuvki-shop.bg');
    expect(domains.some((x) => /wikipedia|youtube|facebook/.test(x))).toBe(false);
    const levels = d.competitors.map((c) => c.competitionLevel);
    expect([...levels].sort((a, b) => b - a)).toEqual(levels);

    // Accept one as an automatic competitor
    await owner.agent
      .post(`/api/v1/projects/${project.body.id}/competitors`)
      .send({ domain: domains[0], source: 'auto' })
      .expect(201);
    const again = await owner.agent
      .get(`/api/v1/projects/${project.body.id}/competitors/discover`)
      .expect(200);
    expect(again.body.creditsCharged).toBe(0);
    expect(
      again.body.competitors.find((c: { domain: string }) => c.domain === domains[0]).tracked,
    ).toBe(true);
  });
});

describe('Acceptance 3.4: keyword gap for a domain and 3 competitors', () => {
  it('distributes keywords into the right tabs and adds them to a list in one click', async () => {
    const owner = await signUpWithOrg(t.app);
    const target = 'seo-pro.bg';
    const competitors = ['web-studio.bg', 'optimizatsiya-hub.com', 'marketing-expert.eu'];
    const all = [target, ...competitors];

    const first = await owner.agent
      .get('/api/v1/domains/keyword-gap')
      .query({ target, competitors: competitors.join(','), tab: 'missing', pageSize: 500 })
      .expect(200);
    const gap = keywordGapResponseSchema.parse(first.body);
    expect(gap.domains).toEqual(all);
    expect(gap.creditsCharged).toBeGreaterThan(0);

    const check: Record<GapTab, (r: KeywordGapRow) => boolean> = {
      missing: (r) =>
        r.positions[target] === null && competitors.every((c) => r.positions[c] !== null),
      untapped: (r) =>
        r.positions[target] === null &&
        competitors.some((c) => r.positions[c] !== null) &&
        competitors.some((c) => r.positions[c] === null),
      unique: (r) =>
        r.positions[target] !== null && competitors.every((c) => r.positions[c] === null),
      shared: (r) => all.every((d) => r.positions[d] !== null),
      weak: (r) =>
        competitors
          .filter((c) => r.positions[c] !== null)
          .every((c) => r.positions[target]! > r.positions[c]!),
      strong: (r) =>
        competitors
          .filter((c) => r.positions[c] !== null)
          .every((c) => r.positions[target]! < r.positions[c]!),
    };

    let totalAcrossTabs = 0;
    for (const tab of GAP_TABS) {
      const res = await owner.agent
        .get('/api/v1/domains/keyword-gap')
        .query({ target, competitors: competitors.join(','), tab, pageSize: 500 })
        .expect(200);
      expect(res.body.creditsCharged).toBe(0); // snapshots reused
      expect(res.body.total).toBe(gap.counts[tab]);
      for (const row of res.body.items as KeywordGapRow[]) expect(check[tab](row)).toBe(true);
      totalAcrossTabs += res.body.total;
    }
    expect(totalAcrossTabs).toBeGreaterThan(0);
    expect(gap.counts.missing).toBeGreaterThan(0);
    expect(gap.counts.shared).toBeGreaterThan(0);

    // One click: add the missing keywords to a list
    const list = await owner.agent
      .post('/api/v1/keyword-lists')
      .send({ name: 'Gap: missing' })
      .expect(201);
    const missing = gap.items.map((r) => r.keyword);
    expect(missing.length).toBeGreaterThan(0);
    const added = await owner.agent
      .post(`/api/v1/keyword-lists/${list.body.id}/items`)
      .send({ keywords: missing })
      .expect(201);
    expect(added.body.added).toBe(missing.length);

    const csv = await owner.agent
      .get('/api/v1/domains/keyword-gap/export')
      .query({ target, competitors: competitors.join(','), tab: 'missing' })
      .buffer(true)
      .expect(200);
    expect(csv.text).toContain('web-studio.bg');
  });

  it('rejects more than 4 competitors and gaps without competitors', async () => {
    const owner = await signUpWithOrg(t.app);
    await owner.agent
      .get('/api/v1/domains/keyword-gap')
      .query({ target: 'a.bg', competitors: 'b.bg,c.bg,d.bg,e.bg,f.bg' })
      .expect(400);
    await owner.agent
      .get('/api/v1/domains/keyword-gap')
      .query({ target: 'a.bg', competitors: 'a.bg' })
      .expect(400);
  });
});

describe('Content gap', () => {
  it('returns competitor topics the target has no ranking keywords for', async () => {
    const owner = await signUpWithOrg(t.app);
    const res = await owner.agent
      .get('/api/v1/domains/content-gap')
      .query({ target: 'seo-pro.bg', competitors: 'web-studio.bg,marketing-expert.eu' })
      .expect(200);
    expect(res.body.topics.length).toBeGreaterThan(0);
    const target = await owner.agent
      .get('/api/v1/domains/keywords')
      .query({ domain: 'seo-pro.bg', pageSize: 500 })
      .expect(200);
    const own = new Set(target.body.items.map((r: { keyword: string }) => r.keyword));
    for (const topic of res.body.topics) expect(own.has(topic.topic)).toBe(false);
  });
});

describe('Domain research permissions and isolation', () => {
  it('blocks discovery on another organization’s project', async () => {
    const a = await signUpWithOrg(t.app, 'A');
    const b = await signUpWithOrg(t.app, 'B');
    const project = await a.agent
      .post('/api/v1/projects')
      .send({ name: 'A', domain: 'a-site.bg' })
      .expect(201);
    await b.agent.get(`/api/v1/projects/${project.body.id}/competitors/discover`).expect(404);
  });
});
