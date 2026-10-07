/**
 * Seeds a demo account for local development (idempotent).
 * Credentials are documented in README.md → "Demo account".
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { eq, schema, type Database } from '@seo/db';
import { AppModule } from '../app.module.js';
import type { Auth } from '../auth/auth.js';
import { AUTH, DB } from '../infra/tokens.js';

export const DEMO_USER = {
  email: 'demo@kompas.local',
  password: 'demo-password-123',
  name: 'Демо Потребител',
};

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
const auth = app.get<Auth>(AUTH);
const db = app.get<Database>(DB);

let [user] = await db.select().from(schema.user).where(eq(schema.user.email, DEMO_USER.email));
if (!user) {
  await auth.api.signUpEmail({ body: { ...DEMO_USER, locale: 'bg' } });
  [user] = await db.select().from(schema.user).where(eq(schema.user.email, DEMO_USER.email));
}
await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, user!.id));

const memberships = await db.select().from(schema.member).where(eq(schema.member.userId, user!.id));
if (memberships.length === 0) {
  const signIn = await auth.api.signInEmail({
    body: { email: DEMO_USER.email, password: DEMO_USER.password },
    returnHeaders: true,
  });
  const cookie = signIn.headers.get('set-cookie') ?? '';
  const headers = new Headers({ cookie: cookie.split(';')[0] ?? '' });
  const org = await auth.api.createOrganization({
    body: { name: 'Демо агенция', slug: `demo-${Date.now().toString(36)}` },
    headers,
  });
  await db.insert(schema.projects).values({
    organizationId: org!.id,
    name: 'Примерен сайт',
    domain: 'primer-seo.bg',
    locationCode: 2100,
    languageCode: 'bg',
    createdBy: user!.id,
  });
  console.log(`Created organization "${org!.name}" with a demo project`);
}

console.log(`Demo account ready: ${DEMO_USER.email} / ${DEMO_USER.password}`);
await app.close();
