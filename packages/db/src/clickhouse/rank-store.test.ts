import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clickhouseEnvSchema, loadRootEnv, parseEnv } from '@seo/shared/server';
import { clickhouseMigrationsFolder } from '../migrations.js';
import { clickHouseConfigFromEnv, createClickHouse, type ClickHouseClient } from './client.js';
import { migrateClickHouse } from './migrate.js';
import {
  competitorRankHistory,
  insertCompetitorRanks,
  insertRankChecks,
  previousRanks,
  rankHistory,
  rankSeriesKey,
  type RankCheckRow,
} from './rank-store.js';

// Integration test: needs ClickHouse from docker compose (own *_test database).
loadRootEnv();
const config = clickHouseConfigFromEnv(
  parseEnv(clickhouseEnvSchema, { ...process.env, CLICKHOUSE_DATABASE: 'seo_store_test' }),
);
let ch: ClickHouseClient;

const check = (
  projectId: string,
  date: string,
  position: number | null,
  checkedAt: string,
  extra: Partial<RankCheckRow> = {},
): RankCheckRow => ({
  projectId,
  keyword: 'зъболекар софия',
  device: 'desktop',
  locationCode: 2100,
  languageCode: 'bg',
  date,
  position,
  url: position === null ? '' : 'https://me.bg/zabolekar',
  volume: 1300,
  serpFeatures: ['local_pack'],
  volatility: 1.5,
  topUrls: ['https://a.bg/', 'https://b.bg/'],
  checkedAt: new Date(checkedAt),
  ...extra,
});

beforeAll(async () => {
  await migrateClickHouse(config, clickhouseMigrationsFolder, () => undefined);
  ch = createClickHouse(config);
  for (const table of ['rank_history', 'rank_competitor_history'])
    await ch.command({ query: 'TRUNCATE TABLE IF EXISTS ' + table });
});
afterAll(async () => {
  await ch?.close();
});

describe('rank store', () => {
  it('keeps the latest check per day, including an unranked (NULL) one', async () => {
    const project = randomUUID();
    await insertRankChecks(ch, [
      check(project, '2026-10-01', 7, '2026-10-01T05:00:00Z'),
      check(project, '2026-10-02', 5, '2026-10-02T05:00:00Z'),
      // Re-check on the same day: dropped out of the top 100.
      check(project, '2026-10-02', null, '2026-10-02T09:00:00Z'),
    ]);
    const history = await rankHistory(ch, project, '2026-09-01', { withTopUrls: true });
    expect(history.map((h) => [h.date, h.position])).toEqual([
      ['2026-10-01', 7],
      ['2026-10-02', null],
    ]);
    expect(history[0]).toMatchObject({ volume: 1300, serpFeatures: ['local_pack'] });
    expect(history[0]!.topUrls).toEqual(['https://a.bg/', 'https://b.bg/']);

    const prev = await previousRanks(ch, project, '2026-10-03');
    const p = prev.get(
      rankSeriesKey({
        keyword: 'зъболекар софия',
        device: 'desktop',
        locationCode: 2100,
        languageCode: 'bg',
      }),
    );
    expect(p).toMatchObject({ date: '2026-10-02', position: null });
    expect((await previousRanks(ch, project, '2026-10-02')).values().next().value).toMatchObject({
      position: 7,
    });
  });

  it('stores competitor positions per domain and isolates projects', async () => {
    const project = randomUUID();
    const base = {
      projectId: project,
      keyword: 'зъболекар софия',
      device: 'desktop' as const,
      locationCode: 2100,
      languageCode: 'bg',
      date: '2026-10-02',
      url: '',
      checkedAt: new Date('2026-10-02T05:00:00Z'),
    };
    await insertCompetitorRanks(ch, [
      { ...base, domain: 'rival.bg', position: 2 },
      { ...base, domain: 'other.bg', position: null },
    ]);
    const rows = await competitorRankHistory(ch, project, '2026-10-01');
    expect(rows.map((r) => [r.domain, r.position]).sort()).toEqual([
      ['other.bg', null],
      ['rival.bg', 2],
    ]);
    expect(await competitorRankHistory(ch, randomUUID(), '2026-10-01')).toEqual([]);
  });
});
