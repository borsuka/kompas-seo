import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

/**
 * Collects the binary body (supertest only buffers text by default). In Node the response is
 * a readable stream; superagent's typings describe the browser Response, hence the cast.
 */
const binary = ((res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}) as never;

describe('PDF reports', () => {
  it('renders a domain report with Cyrillic text, rankings and Search Console sections', async () => {
    const owner = await signUpWithOrg(t.app, 'Агенция');
    const project = await owner.agent
      .post('/api/v1/projects')
      .send({ name: 'Сайт', domain: 'seo-pro.bg' })
      .expect(201);
    await owner.agent.post(`/api/v1/projects/${project.body.id}/gsc/connect`).expect(200);

    const res = await owner.agent
      .get('/api/v1/reports/domain.pdf')
      .query({ domain: 'seo-pro.bg', projectId: project.body.id, ui: 'bg' })
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('seo-report-seo-pro.bg');
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(10_000);
    // The embedded font covers Cyrillic (PDFKit's built-in fonts do not).
    expect(pdf.toString('latin1')).toContain('DejaVuSans');

    // A second report reuses the stored research: no new credits.
    const before = (await owner.agent.get('/api/v1/credits').expect(200)).body.balance;
    await owner.agent
      .get('/api/v1/reports/domain.pdf')
      .query({ domain: 'seo-pro.bg', ui: 'en' })
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect((await owner.agent.get('/api/v1/credits').expect(200)).body.balance).toBe(before);
  });

  it('does not render reports for projects of another organization', async () => {
    const a = await signUpWithOrg(t.app, 'A');
    const project = await a.agent
      .post('/api/v1/projects')
      .send({ name: 'A', domain: 'a-site.bg' })
      .expect(201);
    const b = await signUpWithOrg(t.app, 'B');
    await b.agent
      .get('/api/v1/reports/domain.pdf')
      .query({ domain: 'a-site.bg', projectId: project.body.id })
      .expect(404);
  });
});
