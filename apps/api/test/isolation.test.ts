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

describe('Tenant isolation between organizations', () => {
  it('org B cannot read, modify or delete anything that belongs to org A', async () => {
    const a = await signUpWithOrg(t.app, 'Org A');
    const b = await signUpWithOrg(t.app, 'Org B');

    const project = await a.agent
      .post('/api/v1/projects')
      .send({ name: 'A site', domain: 'a-site.bg' })
      .expect(201);
    const competitor = await a.agent
      .post(`/api/v1/projects/${project.body.id}/competitors`)
      .send({ domain: 'rival.bg' })
      .expect(201);
    const job = await a.agent.post('/api/v1/jobs/demo').send({ steps: 2 }).expect(201);

    // Lists only show own data
    const bProjects = await b.agent.get('/api/v1/projects').expect(200);
    expect(bProjects.body).toEqual([]);

    // Direct access by id looks like "not found"
    await b.agent.get(`/api/v1/projects/${project.body.id}`).expect(404);
    await b.agent.patch(`/api/v1/projects/${project.body.id}`).send({ name: 'pwned' }).expect(404);
    await b.agent.delete(`/api/v1/projects/${project.body.id}`).expect(404);
    await b.agent.get(`/api/v1/projects/${project.body.id}/competitors`).expect(404);
    await b.agent
      .post(`/api/v1/projects/${project.body.id}/competitors`)
      .send({ domain: 'x.bg' })
      .expect(404);
    await b.agent
      .delete(`/api/v1/projects/${project.body.id}/competitors/${competitor.body.id}`)
      .expect(404);
    await b.agent.get(`/api/v1/jobs/${job.body.id}`).expect(404);

    // Selecting org A explicitly does not help: membership is checked
    await b.agent.get('/api/v1/projects').set('x-org-id', a.orgId).expect(404);
    await b.agent.get('/api/v1/credits').set('x-org-id', a.orgId).expect(404);
    await b.agent.get('/api/v1/organization/members').set('x-org-id', a.orgId).expect(404);
    await b.agent.get(`/api/v1/jobs/${job.body.id}`).query({ orgId: a.orgId }).expect(404);
    await b.agent.post(`/api/v1/organizations/${a.orgId}/activate`).expect(404);

    // Org A's data is intact
    const still = await a.agent.get(`/api/v1/projects/${project.body.id}`).expect(200);
    expect(still.body.name).toBe('A site');
    const comps = await a.agent.get(`/api/v1/projects/${project.body.id}/competitors`).expect(200);
    expect(comps.body).toHaveLength(1);
    await a.agent.get(`/api/v1/jobs/${job.body.id}`).expect(200);
  });

  it('a user in two organizations sees data of the selected one only', async () => {
    const a = await signUpWithOrg(t.app, 'First');
    await a.agent
      .post('/api/v1/projects')
      .send({ name: 'First site', domain: 'first.bg' })
      .expect(201);
    const second = await a.agent.post('/api/v1/organizations').send({ name: 'Second' }).expect(201);

    // Creating an org activates it
    const inSecond = await a.agent.get('/api/v1/projects').expect(200);
    expect(inSecond.body).toEqual([]);
    const viaHeader = await a.agent.get('/api/v1/projects').set('x-org-id', a.orgId).expect(200);
    expect(viaHeader.body).toHaveLength(1);

    await a.agent.post(`/api/v1/organizations/${a.orgId}/activate`).expect(204);
    const back = await a.agent.get('/api/v1/projects').expect(200);
    expect(back.body).toHaveLength(1);
    const me = await a.agent.get('/api/v1/me').expect(200);
    expect(me.body.organizations.map((o: { id: string }) => o.id).sort()).toEqual(
      [a.orgId, second.body.id].sort(),
    );
  });
});
