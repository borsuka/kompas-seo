/**
 * Seeds a demo account for local development (idempotent).
 * Credentials are documented in README.md → "Demo account".
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { and, eq, schema, type Database } from '@seo/db';
import {
  insertCompetitorRanks,
  insertRankChecks,
  type ClickHouseClient,
  type CompetitorRankRow,
  type RankCheckRow,
} from '@seo/db/clickhouse';
import { AppModule } from '../app.module.js';
import type { Auth } from '../auth/auth.js';
import { AUTH, CLICKHOUSE, DB } from '../infra/tokens.js';

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

await seedRankHistory(db, app.get<ClickHouseClient>(CLICKHOUSE), user!.id);

console.log(`Demo account ready: ${DEMO_USER.email} / ${DEMO_USER.password}`);
await app.close();

/**
 * Synthetic 30-day rank history for the demo project so the Rankings charts have data
 * on a fresh install. Runs only when the project tracks no keywords yet; no provider calls.
 */
async function seedRankHistory(db: Database, ch: ClickHouseClient, userId: string) {
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.createdBy, userId), eq(schema.projects.domain, 'primer-seo.bg')));
  if (!project) return;
  const tracked = await db
    .select({ id: schema.trackedKeywords.id })
    .from(schema.trackedKeywords)
    .where(eq(schema.trackedKeywords.projectId, project.id));
  if (tracked.length) return;

  const competitors = ['seo-expert.bg', 'web-agency.bg'];
  for (const domain of competitors)
    await db
      .insert(schema.projectCompetitors)
      .values({ organizationId: project.organizationId, projectId: project.id, domain })
      .onConflictDoNothing();

  const keywords: [string, number, string[]][] = [
    ['seo оптимизация', 2400, ['услуги']],
    ['seo оптимизация цена', 590, ['услуги', 'цена']],
    ['seo услуги', 880, ['услуги']],
    ['seo агенция софия', 320, ['локални']],
    ['изработка на сайт', 1900, ['уеб']],
    ['изработка на онлайн магазин', 720, ['уеб']],
    ['google реклама', 1300, ['реклама']],
    ['онлайн маркетинг', 1000, ['реклама']],
    ['какво е seo', 1600, ['блог']],
    ['ключови думи за сайт', 260, ['блог']],
  ];
  await db.insert(schema.trackedKeywords).values(
    keywords.map(([keyword, , tags]) => ({
      organizationId: project.organizationId,
      projectId: project.id,
      keyword,
      locationCode: project.locationCode,
      languageCode: project.languageCode,
      device: 'desktop' as const,
      tags,
      lastCheckedAt: new Date(),
      createdBy: userId,
    })),
  );

  // Deterministic random walk per keyword (seeded by its index), trending slightly upwards.
  const rows: RankCheckRow[] = [];
  const compRows: CompetitorRankRow[] = [];
  keywords.forEach(([keyword, volume], k) => {
    let seed = 1 + k * 7919;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    let pos = 8 + Math.round(rnd() * 30);
    const comp = competitors.map(() => 1 + Math.round(rnd() * 15));
    for (let ago = 29; ago >= 0; ago--) {
      const day = new Date(Date.now() - ago * 86_400_000);
      pos = Math.max(1, Math.min(100, pos + Math.round((rnd() - 0.6) * 4)));
      const date = day.toISOString().slice(0, 10);
      const base = {
        projectId: project.id,
        keyword,
        device: 'desktop' as const,
        locationCode: project.locationCode,
        languageCode: project.languageCode,
        date,
        checkedAt: day,
      };
      rows.push({
        ...base,
        position: k === 9 && ago > 10 ? null : pos,
        url: `https://primer-seo.bg/${k}`,
        volume,
        serpFeatures: [],
        volatility: Math.round(rnd() * 40) / 10,
        topUrls: [],
      });
      competitors.forEach((domain, c) => {
        comp[c] = Math.max(1, Math.min(100, comp[c]! + Math.round((rnd() - 0.5) * 3)));
        compRows.push({ ...base, domain, position: comp[c]!, url: '' });
      });
    }
  });
  await insertRankChecks(ch, rows);
  await insertCompetitorRanks(ch, compRows);
  console.log(`Seeded ${keywords.length} tracked keywords with 30 days of demo rank history`);
}
