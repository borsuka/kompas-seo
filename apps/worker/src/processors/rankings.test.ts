import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyCreditEntry, eq, getCreditBalance, schema, type Database } from '@seo/db';
import { insertRankChecks, rankHistory, type ClickHouseClient } from '@seo/db/clickhouse';
import { truncateAll } from '@seo/db/testing';
import type { RankCheckJobInput } from '@seo/shared';
import { makeContext, setupTestDatabases, type TestEffects } from '../testing.js';
import { checkRankings, scheduleRankChecks } from './rankings.js';

let db: Database;
let ch: ClickHouseClient;
let close: () => Promise<void>;
const sent: TestEffects['sent'] = [];
const enqueued: TestEffects['enqueued'] = [];

/** Job context whose emails and enqueued jobs land in the shared arrays above. */
function context(orgId: string | null) {
  const { ctx, effects } = makeContext({ db, ch }, orgId);
  effects.sent = sent;
  effects.enqueued = enqueued;
  ctx.deps.mailer = { send: async (to, content) => void sent.push({ to, content }) };
  ctx.deps.enqueue = async (type, input, opts) => {
    enqueued.push({ type, input, dedupeKey: opts.dedupeKey });
    return randomUUID();
  };
  return ctx;
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
  ({ db, ch, close } = await setupTestDatabases('seo_worker_test'));
}, 120_000);

beforeEach(async () => {
  await truncateAll(db);
  for (const t of ['rank_history', 'rank_competitor_history', 'serp_snapshots'])
    await ch.command({ query: 'TRUNCATE TABLE IF EXISTS ' + t });
  sent.length = 0;
  enqueued.length = 0;
});

afterAll(async () => {
  await close?.();
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
