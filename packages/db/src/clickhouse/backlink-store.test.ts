import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Backlink, BacklinkSummary, ReferringDomain } from '@seo/shared';
import { clickhouseEnvSchema, loadRootEnv, parseEnv } from '@seo/shared/server';
import { clickhouseMigrationsFolder } from '../migrations.js';
import { insertBacklinkSnapshot, latestBacklinkSnapshot } from './backlink-store.js';
import { clickHouseConfigFromEnv, createClickHouse, type ClickHouseClient } from './client.js';
import { migrateClickHouse } from './migrate.js';

// Integration test: needs ClickHouse from docker compose (own *_test database).
loadRootEnv();
const config = clickHouseConfigFromEnv(
  parseEnv(clickhouseEnvSchema, { ...process.env, CLICKHOUSE_DATABASE: 'seo_store_test' }),
);
let ch: ClickHouseClient;

const summary = (backlinks: number): BacklinkSummary => ({
  target: 'shop.bg',
  backlinks,
  referringDomains: 2,
  referringIps: 2,
  rating: 31,
  dofollow: backlinks - 1,
  nofollow: 1,
  brokenBacklinks: 0,
  spamScore: 3,
  updatedAt: '2026-10-08T00:00:00.000Z',
});
const link = (source: string, extra: Partial<Backlink> = {}): Backlink => ({
  sourceUrl: `https://${source}/post`,
  sourceDomain: source,
  targetUrl: 'https://shop.bg/',
  targetDomain: 'shop.bg',
  anchor: 'Магазин',
  rel: 'follow',
  linkType: 'text',
  sourceRating: 40,
  firstSeen: '2025-01-02T10:00:00.000Z',
  lastSeen: '2026-10-01T08:00:00.000Z',
  lostAt: null,
  targetStatus: 200,
  spamScore: 2,
  ...extra,
});
const domain = (name: string, extra: Partial<ReferringDomain> = {}): ReferringDomain => ({
  domain: name,
  backlinks: 3,
  dofollow: 2,
  rating: 40,
  firstSeen: '2025-01-02T10:00:00.000Z',
  lastSeen: '2026-10-01T08:00:00.000Z',
  lostAt: null,
  spamScore: null,
  ...extra,
});

beforeAll(async () => {
  await migrateClickHouse(config, clickhouseMigrationsFolder, () => undefined);
  ch = createClickHouse(config);
  for (const t of ['backlinks', 'referring_domains', 'backlink_summaries'])
    await ch.command({ query: 'TRUNCATE TABLE IF EXISTS ' + t });
});
afterAll(async () => {
  await ch?.close();
});

describe('backlink store', () => {
  it('returns the latest snapshot only and round-trips nullable fields', async () => {
    expect(await latestBacklinkSnapshot(ch, 'shop.bg', 7)).toBeNull();
    await insertBacklinkSnapshot(
      ch,
      {
        target: 'shop.bg',
        fetchedAt: new Date(Date.now() - 3_600_000),
        summary: summary(10),
        backlinks: [link('old.bg'), link('blog.bg')],
        referringDomains: [domain('old.bg'), domain('blog.bg')],
      },
      'mock',
    );
    await insertBacklinkSnapshot(
      ch,
      {
        target: 'shop.bg',
        fetchedAt: new Date(),
        summary: summary(12),
        backlinks: [
          link('blog.bg', { anchor: 'нов магазин' }),
          link('forum.bg', {
            rel: 'ugc',
            lostAt: '2026-09-01T00:00:00.000Z',
            targetStatus: null,
            spamScore: null,
          }),
        ],
        referringDomains: [
          domain('blog.bg'),
          domain('forum.bg', { lostAt: '2026-09-01T00:00:00.000Z', spamScore: 70 }),
        ],
      },
      'mock',
    );

    const snap = (await latestBacklinkSnapshot(ch, 'shop.bg', 7))!;
    expect(snap.summary.backlinks).toBe(12);
    expect(snap.backlinks.map((b) => b.sourceDomain).sort()).toEqual(['blog.bg', 'forum.bg']);
    expect(snap.backlinks.find((b) => b.sourceDomain === 'blog.bg')!.anchor).toBe('нов магазин');
    expect(snap.backlinks.find((b) => b.sourceDomain === 'forum.bg')).toMatchObject({
      rel: 'ugc',
      lostAt: '2026-09-01T00:00:00.000Z',
      targetStatus: null,
      spamScore: null,
      firstSeen: '2025-01-02T10:00:00.000Z',
    });
    expect(snap.referringDomains.map((d) => d.domain).sort()).toEqual(['blog.bg', 'forum.bg']);
    expect(snap.referringDomains.find((d) => d.domain === 'forum.bg')).toMatchObject({
      spamScore: 70,
    });
    expect(await latestBacklinkSnapshot(ch, 'other.bg', 7)).toBeNull();
  });
});
