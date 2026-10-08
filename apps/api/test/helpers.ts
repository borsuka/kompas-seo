import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { truncateAll } from '@seo/db/testing';
import { eq, schema, type Database } from '@seo/db';
import type { ClickHouseClient } from '@seo/db/clickhouse';
import type { Redis } from 'ioredis';
import { CLICKHOUSE, DB, REDIS } from '../src/infra/tokens.js';

export const ORIGIN = process.env.APP_URL ?? 'http://localhost:3000';

export interface TestApp {
  app: INestApplication;
  db: Database;
  ch: ClickHouseClient;
  close: () => Promise<void>;
}

export async function startApp(): Promise<TestApp> {
  const { createApp } = await import('../src/app.factory.js');
  const app = await createApp();
  await app.init();
  const db = app.get<Database>(DB);
  const ch = app.get<ClickHouseClient>(CLICKHOUSE);
  // Provider responses are cached in Redis; start every suite from a clean test DB (15).
  const redis = app.get<Redis>(REDIS);
  if (redis.options.db !== 15) throw new Error('Refusing to flush a non-test Redis database');
  await redis.flushdb();
  return { app, db, ch, close: () => app.close() };
}

const CLICKHOUSE_TABLES = [
  'keywords',
  'keyword_idea_sets',
  'serp_snapshots',
  'rank_history',
  'domain_keywords',
  'backlinks',
  'domain_metrics',
  'provider_usage',
  'domain_overviews',
];

export async function resetDb(db: Database, ch?: ClickHouseClient) {
  await truncateAll(db);
  if (ch) {
    const [row] = await ch
      .query({ query: 'SELECT currentDatabase() AS db', format: 'JSONEachRow' })
      .then((r) => r.json<{ db: string }>());
    if (!row?.db.endsWith('_test'))
      throw new Error('Refusing to truncate a non-test ClickHouse database');
    for (const table of CLICKHOUSE_TABLES)
      await ch.command({ query: 'TRUNCATE TABLE IF EXISTS ' + table });
  }
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
