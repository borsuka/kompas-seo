import {
  wordCount,
  type Device,
  type IdeaSource,
  type KeywordFilters,
  type KeywordMetrics,
  type KeywordRow,
  type Locale,
  type SerpItem,
  type SerpSnapshot,
} from '@seo/shared';
import type { ClickHouseClient } from './client.js';

/**
 * ClickHouse access for keyword data. All values go through query parameters
 * ({name:Type}); only whitelisted identifiers (sort columns) are interpolated.
 */

const toDate = (d: Date) => d.toISOString().slice(0, 10);
const toDateTime = (d: Date) => d.toISOString().replace('T', ' ').replace('Z', '');

interface KeywordDbRow {
  keyword: string;
  location_code: number;
  language_code: string;
  volume: number;
  cpc: number | null;
  competition: number | null;
  competition_level: string;
  kd: number | null;
  intent: string[];
  trend: number[];
  trend_start: string;
  serp_features: string[];
  word_count: number;
  updated_at: string;
}

function rowToMetrics(r: KeywordDbRow): KeywordMetrics {
  const [y, m] = r.trend_start.split('-').map(Number) as [number, number];
  return {
    keyword: r.keyword,
    locationCode: r.location_code,
    languageCode: r.language_code,
    volume: r.volume,
    cpc: r.cpc,
    competition: r.competition,
    competitionLevel:
      (['low', 'medium', 'high'] as const).find((l) => l === r.competition_level) ?? null,
    trend: r.trend.map((volume, i) => {
      const d = new Date(Date.UTC(y, m - 1 + i, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, volume };
    }),
    kd: r.kd,
    intent: r.intent as KeywordMetrics['intent'],
    serpFeatures: r.serp_features as KeywordMetrics['serpFeatures'],
    updatedAt: new Date(`${r.updated_at.replace(' ', 'T')}Z`).toISOString(),
  };
}

export async function insertKeywordMetrics(
  ch: ClickHouseClient,
  rows: readonly KeywordMetrics[],
  provider: string,
) {
  if (!rows.length) return;
  const now = toDateTime(new Date());
  await ch.insert({
    table: 'keywords',
    format: 'JSONEachRow',
    values: rows.map((m) => {
      const first = m.trend[0];
      return {
        keyword: m.keyword,
        location_code: m.locationCode,
        language_code: m.languageCode,
        volume: m.volume,
        cpc: m.cpc,
        competition: m.competition,
        competition_level: m.competitionLevel ?? '',
        kd: m.kd === null ? null : Math.round(m.kd),
        intent: m.intent,
        trend: m.trend.map((t) => t.volume),
        trend_start: first
          ? `${first.year}-${String(first.month).padStart(2, '0')}-01`
          : toDate(new Date()),
        serp_features: m.serpFeatures,
        word_count: wordCount(m.keyword),
        provider,
        updated_at: now,
      };
    }),
  });
}

/** Latest stored metrics for these keywords, newer than `maxAgeDays`. */
export async function getStoredMetrics(
  ch: ClickHouseClient,
  keywords: readonly string[],
  loc: Locale,
  maxAgeDays: number,
): Promise<Map<string, KeywordMetrics>> {
  const out = new Map<string, KeywordMetrics>();
  if (!keywords.length) return out;
  const res = await ch.query({
    query: `SELECT * FROM keywords FINAL
            WHERE location_code = {loc:UInt32} AND language_code = {lang:String}
              AND keyword IN {kws:Array(String)}
              AND updated_at >= now64(3) - toIntervalDay({days:UInt32})`,
    query_params: {
      loc: loc.locationCode,
      lang: loc.languageCode,
      kws: [...keywords],
      days: maxAgeDays,
    },
    format: 'JSONEachRow',
  });
  for (const r of await res.json<KeywordDbRow>()) out.set(r.keyword, rowToMetrics(r));
  return out;
}

export async function insertIdeaSet(
  ch: ClickHouseClient,
  seed: string,
  loc: Locale,
  ideas: readonly { keyword: string; source: IdeaSource }[],
  provider: string,
) {
  if (!ideas.length) return;
  const fetched = toDateTime(new Date());
  await ch.insert({
    table: 'keyword_idea_sets',
    format: 'JSONEachRow',
    values: ideas.map((i) => ({
      seed,
      location_code: loc.locationCode,
      language_code: loc.languageCode,
      keyword: i.keyword,
      source: i.source,
      provider,
      fetched_at: fetched,
    })),
  });
}

/** When the idea set for this seed was last fetched (null if never / older than maxAgeDays). */
export async function ideaSetFetchedAt(
  ch: ClickHouseClient,
  seed: string,
  loc: Locale,
  maxAgeDays: number,
): Promise<Date | null> {
  const res = await ch.query({
    query: `SELECT max(fetched_at) AS fetched, count() AS n FROM keyword_idea_sets
            WHERE location_code = {loc:UInt32} AND language_code = {lang:String} AND seed = {seed:String}
              AND fetched_at >= now64(3) - toIntervalDay({days:UInt32})`,
    query_params: { loc: loc.locationCode, lang: loc.languageCode, seed, days: maxAgeDays },
    format: 'JSONEachRow',
  });
  const [row] = await res.json<{ fetched: string; n: number }>();
  return row && Number(row.n) > 0 ? new Date(`${row.fetched.replace(' ', 'T')}Z`) : null;
}

const SORT_COLUMNS: Record<string, string> = {
  volume: 'k.volume',
  kd: 'k.kd',
  cpc: 'k.cpc',
  competition: 'k.competition',
  wordCount: 'k.word_count',
  keyword: 'k.keyword',
};

function filterSql(f: KeywordFilters, params: Record<string, unknown>): string[] {
  const where: string[] = [];
  const range = (
    col: string,
    min: number | undefined,
    max: number | undefined,
    type: string,
    name: string,
  ) => {
    if (min !== undefined) {
      where.push(`${col} >= {${name}Min:${type}}`);
      params[`${name}Min`] = min;
    }
    if (max !== undefined) {
      where.push(`${col} <= {${name}Max:${type}}`);
      params[`${name}Max`] = max;
    }
  };
  range('k.volume', f.minVolume, f.maxVolume, 'UInt32', 'vol');
  range('k.kd', f.minKd, f.maxKd, 'UInt8', 'kd');
  range('k.cpc', f.minCpc, f.maxCpc, 'Float32', 'cpc');
  range('k.word_count', f.minWords, f.maxWords, 'UInt8', 'words');
  if (f.intents.length) {
    where.push('hasAny(k.intent, {intents:Array(String)})');
    params.intents = f.intents;
  }
  if (f.features.length) {
    where.push('hasAll(k.serp_features, {features:Array(String)})');
    params.features = f.features;
  }
  f.include.forEach((term, i) => {
    where.push(`positionCaseInsensitiveUTF8(k.keyword, {inc${i}:String}) > 0`);
    params[`inc${i}`] = term;
  });
  f.exclude.forEach((term, i) => {
    where.push(`positionCaseInsensitiveUTF8(k.keyword, {exc${i}:String}) = 0`);
    params[`exc${i}`] = term;
  });
  return where;
}

export interface IdeaQuery {
  seed: string;
  loc: Locale;
  source?: IdeaSource;
  filters: KeywordFilters;
  sort: keyof typeof SORT_COLUMNS;
  dir: 'asc' | 'desc';
  limit: number;
  offset: number;
}

interface RowDb {
  keyword: string;
  volume: number;
  cpc: number | null;
  competition: number | null;
  kd: number | null;
  intent: string[];
  serp_features: string[];
  word_count: number;
  trend: number[];
  source: string;
}

/** Explorer: filter, sort and page the ideas of a seed entirely inside ClickHouse. */
export async function queryIdeas(ch: ClickHouseClient, q: IdeaQuery) {
  const params: Record<string, unknown> = {
    seed: q.seed,
    loc: q.loc.locationCode,
    lang: q.loc.languageCode,
    limit: q.limit,
    offset: q.offset,
  };
  const where = filterSql(q.filters, params);
  const base = `
    FROM (
      SELECT keyword, argMax(source, fetched_at) AS source
      FROM keyword_idea_sets
      WHERE location_code = {loc:UInt32} AND language_code = {lang:String} AND seed = {seed:String}
      GROUP BY keyword
    ) AS i
    INNER JOIN (
      SELECT * FROM keywords FINAL WHERE location_code = {loc:UInt32} AND language_code = {lang:String}
    ) AS k ON k.keyword = i.keyword`;
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sourceWhere = q.source
    ? `${where.length ? 'AND' : 'WHERE'} i.source = {source:String}`
    : '';
  if (q.source) params.source = q.source;
  const sortCol = SORT_COLUMNS[q.sort] ?? 'k.volume';
  const dir = q.dir === 'asc' ? 'ASC' : 'DESC';

  const [rowsRes, countsRes] = await Promise.all([
    ch.query({
      query: `SELECT k.keyword AS keyword, k.volume AS volume, k.cpc AS cpc, k.competition AS competition,
                     k.kd AS kd, k.intent AS intent, k.serp_features AS serp_features,
                     k.word_count AS word_count, arraySlice(k.trend, -12) AS trend, i.source AS source,
                     count() OVER () AS total
              ${base} ${whereSql} ${sourceWhere}
              ORDER BY ${sortCol} ${dir} NULLS LAST, k.keyword ASC
              LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
      query_params: params,
      format: 'JSONEachRow',
    }),
    ch.query({
      query: `SELECT i.source AS source, count() AS n ${base} ${whereSql} GROUP BY i.source`,
      query_params: params,
      format: 'JSONEachRow',
    }),
  ]);

  const rows = await rowsRes.json<RowDb & { total: number }>();
  const counts = await countsRes.json<{ source: string; n: number }>();
  const sourceCounts = Object.fromEntries(counts.map((c) => [c.source, Number(c.n)]));
  const total = q.source
    ? Number(rows[0]?.total ?? 0)
    : Object.values(sourceCounts).reduce((s, n) => s + n, 0);
  return {
    total: rows.length ? Number(rows[0]!.total) : total,
    sourceCounts,
    items: rows.map((r): KeywordRow => ({
      keyword: r.keyword,
      volume: Number(r.volume),
      cpc: r.cpc,
      competition: r.competition,
      kd: r.kd,
      intent: r.intent as KeywordRow['intent'],
      serpFeatures: r.serp_features as KeywordRow['serpFeatures'],
      wordCount: Number(r.word_count),
      trend: r.trend.map(Number),
      source: r.source as IdeaSource,
    })),
  };
}

// ---------------------------------------------------------------- SERP

export async function insertSerpSnapshot(ch: ClickHouseClient, snap: SerpSnapshot) {
  if (!snap.items.length) return;
  const checked = new Date(snap.checkedAt);
  await ch.insert({
    table: 'serp_snapshots',
    format: 'JSONEachRow',
    values: snap.items.map((item) => ({
      keyword: snap.keyword,
      location_code: snap.locationCode,
      language_code: snap.languageCode,
      device: snap.device,
      date: toDate(checked),
      checked_at: toDateTime(checked),
      position: item.rankAbsolute,
      rank_group: item.rankGroup,
      item_type: item.type,
      url: item.url ?? '',
      domain: item.domain ?? '',
      title: item.title ?? '',
      description: item.description ?? '',
      extra: item.extra
        ? JSON.stringify({ ...item.extra, features: snap.features, total: snap.totalResults })
        : JSON.stringify({ features: snap.features, total: snap.totalResults }),
    })),
  });
}

interface SerpDbRow {
  checked_at: string;
  position: number;
  rank_group: number;
  item_type: string;
  url: string;
  domain: string;
  title: string;
  description: string;
  extra: string;
}

/** Most recent stored SERP for a keyword (null when older than maxAgeHours). */
export async function latestSerp(
  ch: ClickHouseClient,
  keyword: string,
  loc: Locale,
  device: Device,
  maxAgeHours: number,
): Promise<SerpSnapshot | null> {
  const res = await ch.query({
    query: `SELECT checked_at, position, rank_group, item_type, url, domain, title, description, extra
            FROM serp_snapshots
            WHERE keyword = {kw:String} AND location_code = {loc:UInt32} AND language_code = {lang:String}
              AND device = {device:String}
              AND checked_at = (
                SELECT max(checked_at) FROM serp_snapshots
                WHERE keyword = {kw:String} AND location_code = {loc:UInt32} AND language_code = {lang:String}
                  AND device = {device:String} AND checked_at >= now64(3) - toIntervalHour({hours:UInt32})
              )
            ORDER BY position`,
    query_params: {
      kw: keyword,
      loc: loc.locationCode,
      lang: loc.languageCode,
      device,
      hours: maxAgeHours,
    },
    format: 'JSONEachRow',
  });
  const rows = await res.json<SerpDbRow>();
  if (!rows.length) return null;
  const meta = JSON.parse(rows[0]!.extra || '{}') as {
    features?: SerpSnapshot['features'];
    total?: number | null;
  };
  return {
    keyword,
    locationCode: loc.locationCode,
    languageCode: loc.languageCode,
    device,
    depth: rows.filter((r) => r.item_type === 'organic').length,
    checkedAt: new Date(`${rows[0]!.checked_at.replace(' ', 'T')}Z`).toISOString(),
    totalResults: meta.total ?? null,
    features: meta.features ?? [],
    items: rows.map((r): SerpItem => {
      const {
        features: _f,
        total: _t,
        ...extra
      } = JSON.parse(r.extra || '{}') as Record<string, unknown>;
      return {
        rankAbsolute: r.position,
        rankGroup: r.rank_group,
        type: r.item_type as SerpItem['type'],
        url: r.url || null,
        domain: r.domain || null,
        title: r.title || null,
        description: r.description || null,
        ...(Object.keys(extra).length ? { extra } : {}),
      };
    }),
  };
}

/** Top-10 organic URLs of the latest stored SERP per keyword (any device), for clustering. */
export async function latestTopUrls(
  ch: ClickHouseClient,
  keywords: readonly string[],
  loc: Locale,
  maxAgeDays: number,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!keywords.length) return out;
  const res = await ch.query({
    query: `SELECT keyword, groupArray(url) AS urls FROM (
              SELECT keyword, url, rank_group FROM serp_snapshots
              WHERE location_code = {loc:UInt32} AND language_code = {lang:String}
                AND keyword IN {kws:Array(String)} AND item_type = 'organic' AND rank_group <= 10
                AND (keyword, checked_at) IN (
                  SELECT keyword, max(checked_at) FROM serp_snapshots
                  WHERE location_code = {loc:UInt32} AND language_code = {lang:String}
                    AND keyword IN {kws:Array(String)}
                    AND checked_at >= now64(3) - toIntervalDay({days:UInt32})
                  GROUP BY keyword
                )
              ORDER BY rank_group
            ) GROUP BY keyword`,
    query_params: {
      loc: loc.locationCode,
      lang: loc.languageCode,
      kws: [...keywords],
      days: maxAgeDays,
    },
    format: 'JSONEachRow',
  });
  for (const r of await res.json<{ keyword: string; urls: string[] }>()) out.set(r.keyword, r.urls);
  return out;
}
