import request from 'supertest';
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
  await resetDb(t.db);
});

describe('Health', () => {
  it('reports liveness and readiness of all dependencies', async () => {
    await request(t.app.getHttpServer()).get('/health/live').expect(200, { status: 'ok' });
    const ready = await request(t.app.getHttpServer()).get('/health/ready').expect(200);
    expect(ready.body).toEqual({
      status: 'ok',
      checks: { postgres: { status: 'ok' }, clickhouse: { status: 'ok' }, redis: { status: 'ok' } },
    });
  });
});

describe('Security', () => {
  it('blocks cookie-authenticated mutations from another origin (CSRF)', async () => {
    const owner = await signUpWithOrg(t.app);
    const res = await owner.agent
      .post('/api/v1/projects')
      .set('Origin', 'https://evil.example')
      .send({ name: 'x', domain: 'x.bg' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('sets security headers and a request id', async () => {
    const res = await request(t.app.getHttpServer())
      .get('/health/live')
      .set('x-request-id', 'abc-123');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-request-id']).toBe('abc-123');
  });

  it('serves the OpenAPI document', async () => {
    const res = await request(t.app.getHttpServer()).get('/docs-json').expect(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(Object.keys(res.body.paths)).toContain('/api/v1/projects');
  });
});

describe('Jobs', () => {
  it('creates a tracked job and returns its status', async () => {
    const owner = await signUpWithOrg(t.app);
    const created = await owner.agent
      .post('/api/v1/jobs/demo')
      .send({ steps: 3, delayMs: 10 })
      .expect(201);
    expect(created.body).toMatchObject({
      type: 'system.demo-progress',
      status: 'queued',
      progress: 0,
    });
    const fetched = await owner.agent.get(`/api/v1/jobs/${created.body.id}`).expect(200);
    expect(fetched.body.id).toBe(created.body.id);
    await owner.agent.get('/api/v1/jobs/not-a-uuid').expect(404);
  });
});
