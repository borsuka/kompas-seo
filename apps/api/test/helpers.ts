import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { truncateAll } from '@seo/db/testing';
import { eq, schema, type Database } from '@seo/db';
import { DB } from '../src/infra/tokens.js';

export const ORIGIN = process.env.APP_URL ?? 'http://localhost:3000';

export interface TestApp {
  app: INestApplication;
  db: Database;
  close: () => Promise<void>;
}

export async function startApp(): Promise<TestApp> {
  const { createApp } = await import('../src/app.factory.js');
  const app = await createApp();
  await app.init();
  const db = app.get<Database>(DB);
  return { app, db, close: () => app.close() };
}

export async function resetDb(db: Database) {
  await truncateAll(db);
}

/** A cookie-keeping client that sends our Origin (required by CSRF checks). */
export function agent(app: INestApplication): TestAgent {
  return request.agent(app.getHttpServer()).set('Origin', ORIGIN);
}

let seq = 0;
export function uniqueEmail(prefix = 'user') {
  seq += 1;
  return `${prefix}.${Date.now()}.${seq}@example.test`;
}

export async function signUp(app: INestApplication, opts: { email?: string; name?: string } = {}) {
  const a = agent(app);
  const email = opts.email ?? uniqueEmail();
  const res = await a
    .post('/api/auth/sign-up/email')
    .send({ email, password: 'correct-horse-battery', name: opts.name ?? 'Test User' });
  if (res.status !== 200)
    throw new Error(`sign-up failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent: a, email, userId: res.body.user.id as string };
}

/** Signs up a user, creates an organization (becomes active) and returns both. */
export async function signUpWithOrg(app: INestApplication, orgName = 'Acme') {
  const user = await signUp(app);
  const res = await user.agent.post('/api/v1/organizations').send({ name: orgName });
  if (res.status !== 201)
    throw new Error(`create org failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...user, orgId: res.body.id as string };
}

/** Marks an email as verified (what clicking the verification link does). */
export async function verifyEmail(db: Database, email: string) {
  await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.email, email));
}
