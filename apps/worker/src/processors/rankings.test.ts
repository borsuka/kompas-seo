import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockProvider } from '@seo/data-providers';
import {
  applyCreditEntry,
  createDb,
  eq,
  getCreditBalance,
  runMigrations,
  schema,
  sql,
  type Database,
} from '@seo/db';
import {
  clickHouseConfigFromEnv,
  createClickHouse,
  insertRankChecks,
  rankHistory,
  type ClickHouseClient,
} from '@seo/db/clickhouse';
import { truncateAll } from '@seo/db/testing';
import { DEFAULT_CREDIT_COSTS, type RankCheckJobInput } from '@seo/shared';
import { clickhouseEnvSchema, loadRootEnv, parseEnv } from '@seo/shared/server';
import type { EmailContent } from '../mailer.js';
import type { JobContext, WorkerDeps } from '../runtime.js';
import { checkRankings, scheduleRankChecks } from './rankings.js';

// Integration test with its own databases (API tests truncate seo_test in parallel).
loadRootEnv();
const DB_NAME = 'seo_worker_test';
const testUrl = new URL(
  process.env.TEST_DATABASE_URL ?? 'postgres://seo:seo@localhost:15432/seo_test',
);
const workerUrl = Object.assign(new URL(testUrl), { pathname: `/${DB_NAME}` }).toString();
const chConfig = clickHouseConfigFromEnv(
  parseEnv(clickhouseEnvSchema, { ...process.env, CLICKHOUSE_DATABASE: DB_NAME }),
);

let db: Database;
let closeDb: () => Promise<void>;
let ch: ClickHouseClient;
const sent: { to: string | string[]; content: EmailContent }[] = [];
const enqueued: { type: string; input: unknown; dedupeKey?: string }[] = [];

function context(orgId: string | null): JobContext {
  const logger = { child: () => logger, info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const deps: WorkerDeps = {
    db,
    clickhouse: ch,
    redis: {} as never,
    providers: { serp: new MockProvider() } as never,
    logger: logger as never,
    mailer: { send: async (to, content) => void sent.push({ to, content }) },
    appUrl: 'http://localhost:3000',
    creditCosts: DEFAULT_CREDIT_COSTS,
    enqueue: async (type, input, opts) => {
      enqueued.push({ type, input, dedupeKey: opts.dedupeKey });
      return randomUUID();
    },
  };
  return {
    deps,
    logger: logger as never,
    progress: async () => undefined,
    attempt: 1,
    isFinalAttempt: true,
    orgId,
  };
}

const KEYWORDS = ['зъболекар софия', 'избелване на зъби', 'детски зъболекар', 'зъбни импланти'];

async function seed() {
  const userId = randomUUID();
  const orgId = randomUUID();
  await db
    .insert(schema.user)
    .values({ id: userId, name: 'Owner', email: `${userId}@example.test`, locale: 'bg' });
  await db.insert(schema.organization).values({ id: orgId, name: 'Clinic', slug: orgId });
  const [project] = await db
    .insert(schema.projects)
    .values({
      organizationId: orgId,
      name: 'Клиника',
      domain: 'moyat-zabolekar.bg',
      locationCode: 2100,
      languageCode: 'bg',
    })
    .returning();
  await db
    .insert(schema.projectCompetitors)
    .values({ organizationId: orgId, projectId: project!.id, domain: 'rival-dent.bg' });
  await db.insert(schema.trackedKeywords).values(
    KEYWORDS.map((keyword) => ({
      organizationId: orgId,
      projectId: project!.id,
      keyword,
      locationCode: 2100,
      languageCode: 'bg',
      device: 'desktop' as const,
      tags: keyword.includes('зъболекар') ? ['core'] : [],
    })),
  );
  await applyCreditEntry(db, { organizationId: orgId, delta: 100, reason: 'manual_adjustment' });
  return { userId, orgId, projectId: project!.id };
}

const input = (projectId: string): RankCheckJobInput => ({
  projectId,
  trigger: 'schedule',
  creditsCharged: 0,
});
const today = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  const admin = createDb(Object.assign(new URL(testUrl), { pathname: '/postgres' }).toString(), {
    max: 1,
  });
  const exists = await admin.db.execute(sql`select 1 from pg_database where datname = ${DB_NAME}`);
  if (!exists.rows.length) await admin.db.execute(sql.raw(`create database ${DB_NAME}`));
  await admin.close();
  await runMigrations({ databaseUrl: workerUrl, clickhouse: chConfig, log: () => undefined });
  ({ db, close: closeDb } = createDb(workerUrl, { max: 4 }));
  ch = createClickHouse(chConfig);
}, 120_000);

beforeEach(async () => {
  await truncateAll(db);
  for (const t of ['rank_history', 'rank_competitor_history', 'serp_snapshots'])
    await ch.command({ query: 'TRUNCATE TABLE IF EXISTS ' + t });
  sent.length = 0;
  enqueued.length = 0;
});

afterAll(async () => {
  await closeDb?.();
  await ch?.close();
});

describe('rankings.check', () => {
  it('checks every tracked keyword, stores history for the project and competitors, charges once per day', async () => {
    const { orgId, projectId } = await seed();
    const res = await checkRankings(input(projectId), context(orgId));
    expect(res).toMatchObject({ checked: 4, failed: 0, creditsCharged: 4 });
    expect(await getCreditBalance(db, orgId)).toBe(96);

    const history = await rankHistory(ch, projectId, '2020-01-01', { withTopUrls: true });
    expect(history).toHaveLength(4);
    // The mock ranks hinted domains for most keywords.
    expect(history.filter((h) => h.position !== null).length).toBeGreaterThanOrEqual(2);
    for (const h of history) {
      expect(h.date).toBe(today());
      expect(h.topUrls.length).toBe(10);
      if (h.position !== null) expect(h.url).toContain('moyat-zabolekar.bg');
    }
    const competitorRows = await ch
      .query({
        query:
          'SELECT count() AS n FROM rank_competitor_history WHERE project_id = {p:UUID} AND domain = {d:String}',
        query_params: { p: projectId, d: 'rival-dent.bg' },
        format: 'JSONEachRow',
      })
      .then((r) => r.json<{ n: string }>());
    expect(Number(competitorRows[0]!.n)).toBe(4);

    const [kw] = await db
      .select()
      .from(schema.trackedKeywords)
      .where(eq(schema.trackedKeywords.projectId, projectId));
    expect(kw!.lastCheckedAt).not.toBeNull();

    // A re-run on the same day (retry) is not charged again.
    const again = await checkRankings(input(projectId), context(orgId));
    expect(again.creditsCharged).toBe(0);
    expect(await getCreditBalance(db, orgId)).toBe(96);
  });

  it('fails without retry when credits are insufficient', async () => {
    const { orgId, projectId } = await seed();
    await applyCreditEntry(db, { organizationId: orgId, delta: -98, reason: 'manual_adjustment' });
    await expect(checkRankings(input(projectId), context(orgId))).rejects.toThrow(/credits/i);
    expect(await getCreditBalance(db, orgId)).toBe(2);
  });

  it('emails one digest per triggered alert and never twice for the same day', async () => {
    const { orgId, projectId, userId } = await seed();
    await db.insert(schema.rankAlerts).values([
      {
        organizationId: orgId,
        projectId,
        type: 'position_gain',
        threshold: 1,
        tag: 'core',
        emails: ['seo@example.test'],
        createdBy: userId,
      },
      {
        organizationId: orgId,
        projectId,
        type: 'position_drop',
        threshold: 1,
        emails: ['boss@example.test'],
        createdBy: userId,
      },
    ]);
    // Yesterday every keyword ranked at 101+ for "core" (gain) — and #1 for the rest (drop).
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await insertRankChecks(
      ch,
      KEYWORDS.map((keyword) => ({
        projectId,
        keyword,
        device: 'desktop' as const,
        locationCode: 2100,
        languageCode: 'bg',
        date: yesterday,
        position: keyword.includes('зъболекар') ? null : 1,
        url: '',
        volume: 100,
        serpFeatures: [],
        volatility: 0,
        topUrls: [],
        checkedAt: new Date(Date.now() - 86_400_000),
      })),
    );

    const res = await checkRankings(input(projectId), context(orgId));
    expect(res.alerts).toBeGreaterThan(0);
    const gain = sent.find((s) => s.to.includes('seo@example.test'));
    expect(gain).toBeDefined();
    expect(gain!.content.subject).toContain('Клиника');
    expect(gain!.content.text).toContain('зъболекар');
    expect(gain!.content.text).not.toContain('импланти');
    expect(sent.find((s) => s.to.includes('boss@example.test'))).toBeDefined();
    const events = await db
      .select()
      .from(schema.rankAlertEvents)
      .where(eq(schema.rankAlertEvents.projectId, projectId));
    expect(events.length).toBe(res.alerts);
    expect(events.every((e) => e.notifiedAt !== null)).toBe(true);

    // Same day again: no duplicate events or emails.
    const before = sent.length;
    await checkRankings({ ...input(projectId), trigger: 'manual' }, context(orgId));
    expect(sent.length).toBe(before);
  });
});

describe('rankings.schedule', () => {
  it('enqueues one daily check per project with due keywords', async () => {
    const { projectId } = await seed();
    await scheduleRankChecks({}, context(null));
    expect(enqueued).toEqual([
      expect.objectContaining({
        type: 'rankings.check',
        dedupeKey: `rank-check:${projectId}:${today()}`,
      }),
    ]);

    // Recently checked keywords are not due.
    await db.update(schema.trackedKeywords).set({ lastCheckedAt: new Date() });
    enqueued.length = 0;
    await scheduleRankChecks({}, context(null));
    expect(enqueued).toEqual([]);
  });
});
