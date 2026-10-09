import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@seo/db';
import { createdApiKeySchema } from '@seo/shared';
import { REDIS } from '../src/infra/tokens.js';
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

const asKey = (key: string) => {
  const http = request(t.app.getHttpServer());
  return {
    get: (path: string) => http.get(path).set('Authorization', `Bearer ${key}`),
    post: (path: string) => http.post(path).set('Authorization', `Bearer ${key}`),
  };
};

async function agencyOwner() {
  const owner = await signUpWithOrg(t.app);
  await t.db
    .update(schema.subscriptions)
    .set({ plan: 'agency' })
    .where(eq(schema.subscriptions.organizationId, owner.orgId));
  await owner.agent
    .post('/api/v1/projects')
    .send({ name: 'Site', domain: 'seo-pro.bg' })
    .expect(201);
  return owner;
}

describe('Public API keys', () => {
  it('are only available on plans with API access', async () => {
    const owner = await signUpWithOrg(t.app);
    const res = await owner.agent
      .post('/api/v1/organization/api-keys')
      .send({ name: 'CI' })
      .expect(403);
    expect(res.body).toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
  });

  it('authenticate as the organization with at most the key role, are shown once and can be revoked', async () => {
    const owner = await agencyOwner();
    const created = createdApiKeySchema.parse(
      (
        await owner.agent
          .post('/api/v1/organization/api-keys')
          .send({ name: 'Reporting', role: 'viewer' })
          .expect(201)
      ).body,
    );
    expect(created.key).toMatch(/^ks_[A-Za-z0-9_-]{43}$/);
    expect(created.prefix).toBe(created.key.slice(0, 10));
    const list = await owner.agent.get('/api/v1/organization/api-keys').expect(200);
    expect(list.body).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(created.key);

    const viewer = asKey(created.key);
    const projects = await viewer.get('/api/v1/projects').expect(200);
    expect(projects.body.map((p: { domain: string }) => p.domain)).toEqual(['seo-pro.bg']);
    await viewer.post('/api/v1/projects').send({ name: 'x', domain: 'x.bg' }).expect(403);
    // Keys cannot manage keys, and are bound to their organization.
    await viewer.get('/api/v1/organization/api-keys').expect(403);
    const other = await signUpWithOrg(t.app, 'Other');
    await viewer.get('/api/v1/projects').set('x-org-id', other.orgId).expect(404);

    const member = createdApiKeySchema.parse(
      (
        await owner.agent
          .post('/api/v1/organization/api-keys')
          .send({ name: 'Automation', role: 'member' })
          .expect(201)
      ).body,
    );
    await asKey(member.key)
      .post('/api/v1/projects')
      .send({ name: 'Second', domain: 'second.bg' })
      .expect(201);

    await owner.agent.delete(`/api/v1/organization/api-keys/${created.id}`).expect(204);
    await viewer.get('/api/v1/projects').expect(401);
    await asKey('ks_not-a-real-key').get('/api/v1/projects').expect(401);
  });

  it('are rate limited per minute by plan and stop working after a downgrade', async () => {
    const owner = await agencyOwner();
    const { body } = await owner.agent
      .post('/api/v1/organization/api-keys')
      .send({ name: 'Load' })
      .expect(201);
    const key = asKey(body.key);
    await key.get('/api/v1/projects').expect(200);

    const redis = t.app.get<Redis>(REDIS);
    await redis.set(
      `ratelimit:apikey:${body.id}:${Math.floor(Date.now() / 60_000)}`,
      '120',
      'EX',
      120,
    );
    const limited = await key.get('/api/v1/projects').expect(429);
    expect(limited.body.code).toBe('RATE_LIMITED');

    await t.db
      .update(schema.subscriptions)
      .set({ plan: 'free' })
      .where(eq(schema.subscriptions.organizationId, owner.orgId));
    await redis.del(`ratelimit:apikey:${body.id}:${Math.floor(Date.now() / 60_000)}`);
    await key.get('/api/v1/projects').expect(403);
  });

  it('cannot be listed or revoked by another organization', async () => {
    const owner = await agencyOwner();
    const { body } = await owner.agent
      .post('/api/v1/organization/api-keys')
      .send({ name: 'Mine' })
      .expect(201);
    const other = await signUpWithOrg(t.app, 'Other');
    await other.agent.delete(`/api/v1/organization/api-keys/${body.id}`).expect(404);
    expect((await owner.agent.get('/api/v1/organization/api-keys').expect(200)).body).toHaveLength(
      1,
    );
  });
});
