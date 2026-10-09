import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@seo/db';
import { insertRankChecks, rankHistory } from '@seo/db/clickhouse';
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

async function ownerWithProject(orgName = 'Агенция Акме') {
  const owner = await signUpWithOrg(t.app, orgName);
  const project = await owner.agent
    .post('/api/v1/projects')
    .send({ name: 'Site', domain: 'seo-pro.bg' })
    .expect(201);
  await insertRankChecks(t.ch, [
    {
      projectId: project.body.id,
      keyword: 'seo',
      device: 'desktop',
      locationCode: 2100,
      languageCode: 'bg',
      date: new Date().toISOString().slice(0, 10),
      position: 4,
      url: 'https://seo-pro.bg/',
      volume: 100,
      serpFeatures: [],
      volatility: 0,
      topUrls: [],
      checkedAt: new Date(),
    },
  ]);
  return { owner, projectId: project.body.id as string };
}

describe('GDPR data export', () => {
  it('exports the account without secrets', async () => {
    const { owner } = await ownerWithProject();
    const res = await owner.agent.get('/api/v1/me/export').buffer(true).expect(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    const data = JSON.parse(res.text);
    expect(data.user.email).toBe(owner.email);
    expect(data.memberships).toEqual([
      expect.objectContaining({ organization: 'Агенция Акме', role: 'owner' }),
    ]);
    expect(data.activity.some((a: { action: string }) => a.action === 'project.created')).toBe(
      true,
    );
    expect(res.text).not.toMatch(/password/i);
  });

  it('exports the organization for owners only, without token or key hashes', async () => {
    const { owner, projectId } = await ownerWithProject();
    await owner.agent.post(`/api/v1/projects/${projectId}/gsc/connect`).expect(200);
    const res = await owner.agent.get('/api/v1/organization/export').buffer(true).expect(200);
    const data = JSON.parse(res.text);
    expect(data.projects.map((p: { domain: string }) => p.domain)).toEqual(['seo-pro.bg']);
    expect(data.rankHistory).toHaveLength(1);
    expect(data.searchConsole).toHaveLength(1);
    expect(res.text).not.toContain('refresh_token_enc');
    expect(res.text).not.toContain('key_hash');
    const viewer = await joinAsViewer(t.app, t.db, owner);
    await viewer.agent.get('/api/v1/organization/export').expect(403);
  });
});

describe('GDPR erasure', () => {
  it('deletes an organization with its projects and analytics after typing its name', async () => {
    const { owner, projectId } = await ownerWithProject();
    await owner.agent
      .post('/api/v1/organization/delete')
      .send({ confirmName: 'wrong' })
      .expect(400);
    await owner.agent
      .post('/api/v1/organization/delete')
      .send({ confirmName: 'Агенция Акме' })
      .expect(204);
    expect(
      await t.db.select().from(schema.organization).where(eq(schema.organization.id, owner.orgId)),
    ).toEqual([]);
    expect(
      await t.db.select().from(schema.projects).where(eq(schema.projects.id, projectId)),
    ).toEqual([]);
    expect(await rankHistory(t.ch, projectId, '2000-01-01')).toEqual([]);
    const me = await owner.agent.get('/api/v1/me').expect(200);
    expect(me.body.activeOrganization).toBeNull();
  });

  it('blocks account deletion while other members depend on the user as sole owner', async () => {
    const { owner } = await ownerWithProject();
    await joinAsViewer(t.app, t.db, owner);
    const check = await owner.agent.get('/api/v1/me/deletion-check').expect(200);
    expect(check.body.mustTransfer).toEqual([expect.objectContaining({ name: 'Агенция Акме' })]);
    const res = await owner.agent
      .post('/api/v1/me/delete')
      .send({ confirmEmail: owner.email })
      .expect(409);
    expect(res.body.code).toBe('CONFLICT');
  });

  it('deletes the account and the organizations where the user was alone', async () => {
    const { owner, projectId } = await ownerWithProject();
    await owner.agent
      .post('/api/v1/me/delete')
      .send({ confirmEmail: 'other@example.test' })
      .expect(400);
    await owner.agent
      .post('/api/v1/me/delete')
      .send({ confirmEmail: owner.email.toUpperCase() })
      .expect(204);
    expect(await t.db.select().from(schema.user).where(eq(schema.user.id, owner.userId))).toEqual(
      [],
    );
    expect(
      await t.db.select().from(schema.projects).where(eq(schema.projects.id, projectId)),
    ).toEqual([]);
    expect(await rankHistory(t.ch, projectId, '2000-01-01')).toEqual([]);
    await owner.agent.get('/api/v1/me').expect(401);
  });
});
