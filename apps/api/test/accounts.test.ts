import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  agent,
  resetDb,
  signUp,
  signUpWithOrg,
  startApp,
  uniqueEmail,
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
  await resetDb(t.db);
});

describe('Acceptance 3.1: accounts, organizations, projects and roles', () => {
  it('registers, creates an org + project, invites a viewer who cannot edit', async () => {
    // 1. Register
    const owner = await signUp(t.app, { name: 'Owner' });
    const me0 = await owner.agent.get('/api/v1/me').expect(200);
    expect(me0.body.organizations).toEqual([]);
    expect(me0.body.activeOrganization).toBeNull();

    // 2. Create organization → becomes active, gets free plan credits
    const org = await owner.agent
      .post('/api/v1/organizations')
      .send({ name: 'Агенция Акме' })
      .expect(201);
    const me1 = await owner.agent.get('/api/v1/me').expect(200);
    expect(me1.body.activeOrganization).toMatchObject({
      id: org.body.id,
      name: 'Агенция Акме',
      role: 'owner',
      plan: 'free',
      creditBalance: 500,
    });

    // 3. Create project (domain is normalized)
    const project = await owner.agent
      .post('/api/v1/projects')
      .send({
        name: 'Main site',
        domain: 'https://www.Example.bg/',
        locationCode: 2100,
        languageCode: 'bg',
      })
      .expect(201);
    expect(project.body).toMatchObject({
      domain: 'example.bg',
      locationCode: 2100,
      languageCode: 'bg',
      device: 'desktop',
    });

    // 4. Invite a colleague as viewer
    const viewerEmail = uniqueEmail('viewer');
    const invite = await owner.agent
      .post('/api/v1/organization/invitations')
      .send({ email: viewerEmail, role: 'viewer' })
      .expect(201);
    expect(invite.body).toMatchObject({ email: viewerEmail, role: 'viewer', status: 'pending' });
    const pending = await owner.agent.get('/api/v1/organization/invitations').expect(200);
    expect(pending.body).toHaveLength(1);

    // 5. Viewer signs up and accepts
    const viewer = await signUp(t.app, { email: viewerEmail, name: 'Viewer' });
    const details = await viewer.agent.get(`/api/v1/invitations/${invite.body.id}`).expect(200);
    expect(details.body).toMatchObject({ organizationName: 'Агенция Акме', role: 'viewer' });
    await viewer.agent.post(`/api/v1/invitations/${invite.body.id}/accept`).expect(201);
    await viewer.agent.post(`/api/v1/organizations/${org.body.id}/activate`).expect(204);

    const viewerMe = await viewer.agent.get('/api/v1/me').expect(200);
    expect(viewerMe.body.activeOrganization).toMatchObject({ id: org.body.id, role: 'viewer' });

    // 6. Viewer can read …
    const list = await viewer.agent.get('/api/v1/projects').expect(200);
    expect(list.body.map((p: { id: string }) => p.id)).toEqual([project.body.id]);
    await viewer.agent.get(`/api/v1/projects/${project.body.id}`).expect(200);
    await viewer.agent.get('/api/v1/organization/members').expect(200);
    await viewer.agent.get('/api/v1/credits').expect(200);

    // … but cannot edit anything
    const forbidden = await viewer.agent
      .patch(`/api/v1/projects/${project.body.id}`)
      .send({ name: 'Hacked' });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe('FORBIDDEN');
    await viewer.agent.post('/api/v1/projects').send({ name: 'x', domain: 'x.bg' }).expect(403);
    await viewer.agent.delete(`/api/v1/projects/${project.body.id}`).expect(403);
    await viewer.agent
      .post(`/api/v1/projects/${project.body.id}/competitors`)
      .send({ domain: 'rival.bg' })
      .expect(403);
    await viewer.agent
      .post('/api/v1/organization/invitations')
      .send({ email: uniqueEmail(), role: 'viewer' })
      .expect(403);
    await viewer.agent.post('/api/v1/jobs/demo').send({}).expect(403);

    // Better Auth's own endpoints enforce the same rule
    const direct = await viewer.agent
      .post('/api/auth/organization/invite-member')
      .send({ email: uniqueEmail(), role: 'viewer', organizationId: org.body.id });
    expect(direct.status).toBeGreaterThanOrEqual(400);

    const unchanged = await owner.agent.get(`/api/v1/projects/${project.body.id}`).expect(200);
    expect(unchanged.body.name).toBe('Main site');
  });

  it('lists members and lets an owner change roles and remove members', async () => {
    const owner = await signUpWithOrg(t.app);
    const email = uniqueEmail('member');
    const inv = await owner.agent
      .post('/api/v1/organization/invitations')
      .send({ email, role: 'member' })
      .expect(201);
    const member = await signUp(t.app, { email });
    await member.agent.post(`/api/v1/invitations/${inv.body.id}/accept`).expect(201);

    const members = await owner.agent.get('/api/v1/organization/members').expect(200);
    expect(members.body.map((m: { role: string }) => m.role).sort()).toEqual(['member', 'owner']);
    const target = members.body.find((m: { role: string }) => m.role === 'member');

    await owner.agent
      .patch(`/api/v1/organization/members/${target.id}`)
      .send({ role: 'viewer' })
      .expect(204);
    const after = await owner.agent.get('/api/v1/organization/members').expect(200);
    expect(after.body.find((m: { id: string }) => m.id === target.id).role).toBe('viewer');

    // Owner role cannot be assigned through this endpoint
    await owner.agent
      .patch(`/api/v1/organization/members/${target.id}`)
      .send({ role: 'owner' })
      .expect(400);

    const ownerRow = after.body.find((m: { role: string }) => m.role === 'owner');
    await owner.agent.delete(`/api/v1/organization/members/${ownerRow.id}`).expect(403);
    await owner.agent.delete(`/api/v1/organization/members/${target.id}`).expect(204);
    const final = await owner.agent.get('/api/v1/organization/members').expect(200);
    expect(final.body).toHaveLength(1);
  });

  it('enforces plan limits for projects and members (free plan)', async () => {
    const owner = await signUpWithOrg(t.app);
    await owner.agent.post('/api/v1/projects').send({ name: 'One', domain: 'one.bg' }).expect(201);
    const second = await owner.agent
      .post('/api/v1/projects')
      .send({ name: 'Two', domain: 'two.bg' });
    expect(second.status).toBe(403);
    expect(second.body.code).toBe('PLAN_LIMIT_REACHED');

    await owner.agent
      .post('/api/v1/organization/invitations')
      .send({ email: uniqueEmail(), role: 'viewer' })
      .expect(201);
    const third = await owner.agent
      .post('/api/v1/organization/invitations')
      .send({ email: uniqueEmail(), role: 'viewer' });
    expect(third.body.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('manages project competitors with normalization and duplicates rejected', async () => {
    const owner = await signUpWithOrg(t.app);
    const p = await owner.agent
      .post('/api/v1/projects')
      .send({ name: 'Site', domain: 'site.bg' })
      .expect(201);
    const c = await owner.agent
      .post(`/api/v1/projects/${p.body.id}/competitors`)
      .send({ domain: 'https://www.Rival.bg/page' })
      .expect(201);
    expect(c.body).toMatchObject({ domain: 'rival.bg', source: 'manual' });
    await owner.agent
      .post(`/api/v1/projects/${p.body.id}/competitors`)
      .send({ domain: 'rival.bg' })
      .expect(409);
    await owner.agent
      .post(`/api/v1/projects/${p.body.id}/competitors`)
      .send({ domain: 'site.bg' })
      .expect(400);
    const list = await owner.agent.get(`/api/v1/projects/${p.body.id}/competitors`).expect(200);
    expect(list.body).toHaveLength(1);
    await owner.agent.delete(`/api/v1/projects/${p.body.id}/competitors/${c.body.id}`).expect(204);
  });

  it('rejects invalid input with a structured validation error', async () => {
    const owner = await signUpWithOrg(t.app);
    const res = await owner.agent
      .post('/api/v1/projects')
      .send({ name: '', domain: 'not a domain' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details.map((d: { path: string }) => d.path).sort()).toEqual([
      'domain',
      'name',
    ]);
    expect(res.body.requestId).toBeTruthy();
  });

  it('requires a session', async () => {
    const res = await agent(t.app).get('/api/v1/projects').expect(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });
});
