import type { ClickHouseClient } from './client.js';

/**
 * Search Console performance rows (parameterized queries only). Rows are re-synced for
 * recent days (data is finalized after 2–3 days); ReplacingMergeTree keeps the latest copy,
 * reads use FINAL so a re-synced day is never counted twice.
 */

export interface GscRow {
  date: string;
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export async function insertGscRows(
  ch: ClickHouseClient,
  projectId: string,
  rows: readonly GscRow[],
  syncedAt: Date,
) {
  if (!rows.length) return;
  const synced = syncedAt.toISOString().replace('T', ' ').replace('Z', '');
  for (let i = 0; i < rows.length; i += 50_000)
    await ch.insert({
      table: 'gsc_daily',
      format: 'JSONEachRow',
      values: rows.slice(i, i + 50_000).map((r) => ({
        project_id: projectId,
        date: r.date,
        query: r.query,
        page: r.page,
        clicks: Math.round(r.clicks),
        impressions: Math.round(r.impressions),
        ctr: r.ctr,
        position: r.position,
        synced_at: synced,
      })),
    });
}

/** Project and inclusive date range (YYYY-MM-DD). */
type Range = {
  project: string;
  from: string;
  to: string;
};

const num = (v: unknown) => Number(v ?? 0);

/** Totals per day (position = impression-weighted average). */
export async function gscDaily(ch: ClickHouseClient, p: Range) {
  const rows = await ch
    .query({
      query: `SELECT toString(date) AS day, sum(clicks) AS c, sum(impressions) AS i,
                     sum(position * impressions) / greatest(sum(impressions), 1) AS p
              FROM gsc_daily FINAL
              WHERE project_id = {project:UUID} AND date BETWEEN {from:Date} AND {to:Date}
              GROUP BY date ORDER BY date`,
      query_params: p,
      format: 'JSONEachRow',
    })
    .then((r) => r.json<{ day: string; c: string; i: string; p: number }>());
  return rows.map((r) => ({
    date: r.day,
    clicks: num(r.c),
    impressions: num(r.i),
    position: Math.round(num(r.p) * 10) / 10,
  }));
}

export interface GscAggregate {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** Totals grouped by `query` or `page`, most clicks first. */
export async function gscTop(
  ch: ClickHouseClient,
  p: Range & { by: 'query' | 'page'; search?: string; limit: number; offset: number },
): Promise<{ rows: GscAggregate[]; total: number }> {
  const column = p.by === 'query' ? 'query' : 'page';
  const where = `project_id = {project:UUID} AND date BETWEEN {from:Date} AND {to:Date}
                 ${p.search ? `AND positionCaseInsensitiveUTF8(${column}, {search:String}) > 0` : ''}`;
  const params = { ...p, search: p.search ?? '' };
  const rows = await ch
    .query({
      query: `SELECT ${column} AS key, sum(clicks) AS c, sum(impressions) AS i,
                     sum(position * impressions) / greatest(sum(impressions), 1) AS p
              FROM gsc_daily FINAL WHERE ${where}
              GROUP BY key ORDER BY c DESC, i DESC, key
              LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
      query_params: params,
      format: 'JSONEachRow',
    })
    .then((r) => r.json<{ key: string; c: string; i: string; p: number }>());
  const [count] = await ch
    .query({
      query: `SELECT uniqExact(${column}) AS n FROM gsc_daily FINAL WHERE ${where}`,
      query_params: params,
      format: 'JSONEachRow',
    })
    .then((r) => r.json<{ n: string }>());
  return {
    rows: rows.map((r) => {
      const clicks = num(r.c);
      const impressions = num(r.i);
      return {
        key: r.key,
        clicks,
        impressions,
        ctr: impressions ? Math.round((clicks / impressions) * 10_000) / 10_000 : 0,
        position: Math.round(num(r.p) * 10) / 10,
      };
    }),
    total: num(count?.n),
  };
}

/** Totals per query + page (cannibalization, calibration). */
export async function gscQueryPages(ch: ClickHouseClient, p: Range & { minImpressions?: number }) {
  const rows = await ch
    .query({
      query: `SELECT query, page, sum(clicks) AS c, sum(impressions) AS i,
                     sum(position * impressions) / greatest(sum(impressions), 1) AS p
              FROM gsc_daily FINAL
              WHERE project_id = {project:UUID} AND date BETWEEN {from:Date} AND {to:Date}
              GROUP BY query, page
              HAVING i >= {min:UInt32}`,
      query_params: { ...p, min: p.minImpressions ?? 1 },
      format: 'JSONEachRow',
    })
    .then((r) =>
      r.json<{
        query: string;
        page: string;
        c: string;
        i: string;
        p: number;
      }>(),
    );
  return rows.map((r) => ({
    query: r.query,
    page: r.page,
    clicks: num(r.c),
    impressions: num(r.i),
    position: num(r.p),
  }));
}

/** Latest date with data for a project (Search Console lags 2–3 days). */
export async function gscLatestDate(
  ch: ClickHouseClient,
  projectId: string,
): Promise<string | null> {
  const [row] = await ch
    .query({
      query: `SELECT toString(max(date)) AS day, count() AS n FROM gsc_daily WHERE project_id = {project:UUID}`,
      query_params: { project: projectId },
      format: 'JSONEachRow',
    })
    .then((r) => r.json<{ day: string; n: string }>());
  return row && num(row.n) > 0 ? row.day : null;
}

/** Removes all Search Console data of a project (disconnect / GDPR). */
export async function deleteGscProject(ch: ClickHouseClient, projectId: string) {
  await ch.command({
    query: 'ALTER TABLE gsc_daily DELETE WHERE project_id = {project:UUID}',
    query_params: { project: projectId },
    clickhouse_settings: { mutations_sync: '1' },
  });
}
