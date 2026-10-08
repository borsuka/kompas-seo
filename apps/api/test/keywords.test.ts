import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getCreditBalance } from '@seo/db';
import { keywordOverviewSchema, explorerResponseSchema } from '@seo/shared';
import {
  resetDb,
  signUp,
  signUpWithOrg,
  startApp,
  uniqueEmail,
  verifyEmail,
  type TestApp,
} from './helpers.js';

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

// Each run uses a unique seed so ClickHouse data (not truncated between tests) never leaks.
const seed = (base: string) =>
  `${base} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

describe('Acceptance 3.2: Keyword Explorer', () => {
  it('"seo оптимизация" (BG, bg) returns ideas with every field; filters run on the server', async () => {
    const owner = await signUpWithOrg(t.app);
    const res = await owner.agent
      .get('/api/v1/keywords/explore')
      .query({ q: 'SEO Оптимизация', loc: 2100, lang: 'bg', pageSize: 100 })
      .expect(200);
    const body = explorerResponseSchema.parse(res.body);
    expect(body.seed).toBe('seo оптимизация');
    expect(body.total).toBeGreaterThan(50);
    expect(body.items.length).toBe(Math.min(100, body.total));
    for (const item of body.items) {
      expect(item.keyword).toBeTruthy();
      expect(item.volume).toBeGreaterThanOrEqual(0);
      expect(item.intent.length).toBeGreaterThan(0);
      expect(item.trend).toHaveLength(12);
      expect(item.source).toBeTruthy();
    }
    expect(Object.keys(body.sourceCounts).sort()).toEqual([
      'autocomplete',
      'matching',
      'question',
      'related',
    ]);
    // Sorted by volume desc by default
    const volumes = body.items.map((i) => i.volume);
    expect([...volumes].sort((a, b) => b - a)).toEqual(volumes);

    const charged = body.creditsCharged;
    expect(charged).toBe(10);
    expect(await getCreditBalance(t.db, owner.orgId)).toBe(490);

    // Filters (server side) — and no new charge: stored ideas are reused
    const filtered = await owner.agent
      .get('/api/v1/keywords/explore')
      .query({
        q: 'seo оптимизация',
        minVolume: 10,
        maxKd: 60,
        intents: 'informational',
        include: 'как',
        sort: 'kd',
        dir: 'asc',
      })
      .expect(200);
    expect(filtered.body.creditsCharged).toBe(0);
    expect(filtered.body.total).toBeLessThan(body.total);
    for (const i of filtered.body.items) {
      expect(i.volume).toBeGreaterThanOrEqual(10);
      expect(i.kd).toBeLessThanOrEqual(60);
      expect(i.intent).toContain('informational');
      expect(i.keyword).toContain('как');
    }
    const kds = filtered.body.items.map((i: { kd: number }) => i.kd);
    expect([...kds].sort((a, b) => a - b)).toEqual(kds);

    const questions = await owner.agent
      .get('/api/v1/keywords/explore')
      .query({ q: 'seo оптимизация', source: 'question' })
      .expect(200);
    expect(questions.body.items.every((i: { source: string }) => i.source === 'question')).toBe(
      true,
    );
    expect(await getCreditBalance(t.db, owner.orgId)).toBe(490);
  });

  it('exports filtered ideas as CSV (UTF-8 BOM, Cyrillic) and XLSX', async () => {
    const owner = await signUpWithOrg(t.app);
    const q = seed('обувки');
    await owner.agent.get('/api/v1/keywords/explore').query({ q }).expect(200);
    const csv = await owner.agent
      .get('/api/v1/keywords/explore/export')
      .query({ q, format: 'csv' })
      .buffer(true)
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const text = csv.text ?? csv.body.toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('Ключова дума');
    expect(text).toContain('обувки');

    const xlsx = await owner.agent
      .get('/api/v1/keywords/explore/export')
      .query({ q, format: 'xlsx', ui: 'en' })
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });

  it('validates input and rejects unknown locations', async () => {
    const owner = await signUpWithOrg(t.app);
    await owner.agent.get('/api/v1/keywords/explore').query({ q: '' }).expect(400);
    await owner.agent.get('/api/v1/keywords/explore').query({ q: 'seo', loc: 9999 }).expect(400);
    await owner.agent.get('/api/v1/keywords/explore').query({ q: 'seo', maxKd: 500 }).expect(400);
  });
});

describe('Keyword Overview', () => {
  it('returns metrics, trend, SERP top 10 with page metrics, KD and parent topic', async () => {
    const owner = await signUpWithOrg(t.app);
    const q = seed('seo оптимизация цена');
    const res = await owner.agent.get('/api/v1/keywords/overview').query({ q }).expect(200);
    const o = keywordOverviewSchema.parse(res.body);
    expect(o.metrics.keyword).toBe(q);
    expect(o.metrics.trend.length).toBeGreaterThan(0);
    expect(o.serp.results).toHaveLength(10);
    expect(o.serp.results.every((r) => r.referringDomains !== null)).toBe(true);
    expect(o.kdSource).toBe('computed');
    expect(o.kd).toBeGreaterThanOrEqual(0);
    expect(o.trafficPotential).toBeGreaterThanOrEqual(0);
    // metrics (1) + SERP depth 10 (5) + page metrics (10)
    expect(o.creditsCharged).toBe(16);

    const again = await owner.agent.get('/api/v1/keywords/overview').query({ q }).expect(200);
    expect(again.body.creditsCharged).toBe(0);
    expect(again.body.kd).toBe(o.kd);
  });
});

describe('Keyword lists', () => {
  it('creates a list, adds keywords with metrics, edits notes/tags, filters, exports and removes', async () => {
    const owner = await signUpWithOrg(t.app);
    const list = await owner.agent
      .post('/api/v1/keyword-lists')
      .send({ name: 'Статии', tags: ['блог'] })
      .expect(201);
    expect(list.body).toMatchObject({
      name: 'Статии',
      itemCount: 0,
      locationCode: 2100,
      languageCode: 'bg',
    });

    const base = seed('маратонки');
    const keywords = [base, `купи ${base}`, `${base} цена`, `как да изберем ${base}`];
    const added = await owner.agent
      .post(`/api/v1/keyword-lists/${list.body.id}/items`)
      .send({ keywords: [...keywords, keywords[0]] })
      .expect(201);
    expect(added.body).toMatchObject({ added: 4, skipped: 0, creditsCharged: 1 });
    const again = await owner.agent
      .post(`/api/v1/keyword-lists/${list.body.id}/items`)
      .send({ keywords })
      .expect(201);
    expect(again.body).toMatchObject({ added: 0, skipped: 4, creditsCharged: 0 });

    const items = await owner.agent.get(`/api/v1/keyword-lists/${list.body.id}/items`).expect(200);
    expect(items.body.total).toBe(4);
    const item = items.body.items[0];
    await owner.agent
      .patch(`/api/v1/keyword-lists/${list.body.id}/items/${item.id}`)
      .send({ note: 'Приоритет', tags: ['топ'] })
      .expect(204);
    const tagged = await owner.agent
      .get(`/api/v1/keyword-lists/${list.body.id}/items`)
      .query({ tag: 'топ' })
      .expect(200);
    expect(tagged.body.items).toHaveLength(1);
    expect(tagged.body.items[0].note).toBe('Приоритет');

    const transactional = await owner.agent
      .get(`/api/v1/keyword-lists/${list.body.id}/items`)
      .query({ intents: 'transactional' })
      .expect(200);
    expect(transactional.body.items.map((i: { keyword: string }) => i.keyword).sort()).toEqual(
      [`${base} цена`, `купи ${base}`].sort(),
    );

    const csv = await owner.agent
      .get(`/api/v1/keyword-lists/${list.body.id}/export`)
      .buffer(true)
      .expect(200);
    expect(csv.text).toContain('Бележка');
    expect(csv.text).toContain('Приоритет');

    const removed = await owner.agent
      .post(`/api/v1/keyword-lists/${list.body.id}/items/remove`)
      .send({ ids: [item.id] })
      .expect(201);
    expect(removed.body.removed).toBe(1);
    const lists = await owner.agent.get('/api/v1/keyword-lists').expect(200);
    expect(lists.body[0].itemCount).toBe(3);

    await owner.agent.delete(`/api/v1/keyword-lists/${list.body.id}`).expect(204);
    await owner.agent.get(`/api/v1/keyword-lists/${list.body.id}`).expect(404);
  });

  it('starts clustering as a job and charges per keyword without a stored SERP', async () => {
    const owner = await signUpWithOrg(t.app);
    const list = await owner.agent
      .post('/api/v1/keyword-lists')
      .send({ name: 'Cluster me' })
      .expect(201);
    const base = seed('зимни гуми');
    const keywords = Array.from({ length: 20 }, (_, i) => `${base} ${i}`);
    await owner.agent
      .post(`/api/v1/keyword-lists/${list.body.id}/items`)
      .send({ keywords })
      .expect(201);
    const before = await getCreditBalance(t.db, owner.orgId);

    const job = await owner.agent
      .post(`/api/v1/keyword-lists/${list.body.id}/cluster`)
      .send({})
      .expect(201);
    expect(job.body).toMatchObject({ type: 'keywords.cluster', status: 'queued' });
    expect(await getCreditBalance(t.db, owner.orgId)).toBe(before - 20);
    await owner.agent.get(`/api/v1/jobs/${job.body.id}`).expect(200);
  });

  it('viewers can read lists but cannot change them or spend credits', async () => {
    const owner = await signUpWithOrg(t.app);
    const list = await owner.agent
      .post('/api/v1/keyword-lists')
      .send({ name: 'Shared' })
      .expect(201);
    const email = uniqueEmail('viewer');
    const inv = await owner.agent
      .post('/api/v1/organization/invitations')
      .send({ email, role: 'viewer' })
      .expect(201);
    const viewer = await signUp(t.app, { email });
    await verifyEmail(t.db, email);
    await viewer.agent.post(`/api/v1/invitations/${inv.body.id}/accept`).expect(201);
    await viewer.agent.post(`/api/v1/organizations/${owner.orgId}/activate`).expect(204);

    await viewer.agent.get('/api/v1/keyword-lists').expect(200);
    await viewer.agent.get(`/api/v1/keyword-lists/${list.body.id}/items`).expect(200);
    await viewer.agent.post('/api/v1/keyword-lists').send({ name: 'x' }).expect(403);
    await viewer.agent
      .post(`/api/v1/keyword-lists/${list.body.id}/items`)
      .send({ keywords: ['a'] })
      .expect(403);
    // New research spends credits → forbidden; stored research is readable
    const res = await viewer.agent.get('/api/v1/keywords/explore').query({ q: seed('ново') });
    expect(res.status).toBe(403);
    expect(res.body.details).toEqual({ permission: 'research:run' });
  });

  it('isolates lists between organizations', async () => {
    const a = await signUpWithOrg(t.app, 'A');
    const b = await signUpWithOrg(t.app, 'B');
    const list = await a.agent.post('/api/v1/keyword-lists').send({ name: 'Secret' }).expect(201);
    expect((await b.agent.get('/api/v1/keyword-lists').expect(200)).body).toEqual([]);
    await b.agent.get(`/api/v1/keyword-lists/${list.body.id}`).expect(404);
    await b.agent.get(`/api/v1/keyword-lists/${list.body.id}/items`).expect(404);
    await b.agent.patch(`/api/v1/keyword-lists/${list.body.id}`).send({ name: 'x' }).expect(404);
    await b.agent
      .post(`/api/v1/keyword-lists/${list.body.id}/items`)
      .send({ keywords: ['x'] })
      .expect(404);
    await b.agent.post(`/api/v1/keyword-lists/${list.body.id}/cluster`).send({}).expect(404);
    await b.agent.get(`/api/v1/keyword-lists/${list.body.id}/export`).expect(404);
    await b.agent.delete(`/api/v1/keyword-lists/${list.body.id}`).expect(404);
    await a.agent.get(`/api/v1/keyword-lists/${list.body.id}`).expect(200);
  });
});
