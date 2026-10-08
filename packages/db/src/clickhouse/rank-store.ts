import type { Device } from '@seo/shared';
import type { ClickHouseClient } from './client.js';

/**
 * ClickHouse access for rank tracking history (parameterized queries only).
 * Positions are wrapped in tuple() inside argMax: aggregate functions skip NULLs, and an
 * unranked latest check (NULL) must win over an older ranked one.
 */

const toDateTime64 = (d: Date) => d.toISOString().replace('T', ' ').replace('Z', '');

export interface RankCheckRow {
  projectId: string;
  keyword: string;
  device: Device;
  locationCode: number;
  languageCode: string;
  /** YYYY-MM-DD (UTC) of the check. */
  date: string;
  position: number | null;
  url: string;
  volume: number;
  serpFeatures: readonly string[];
  volatility: number;
  topUrls: readonly string[];
  checkedAt: Date;
}

export interface CompetitorRankRow {
  projectId: string;
  keyword: string;
  device: Device;
  locationCode: number;
  languageCode: string;
  date: string;
  domain: string;
  position: number | null;
  url: string;
  checkedAt: Date;
}

/** Key that identifies one tracked keyword series in ClickHouse. */
export const rankSeriesKey = (r: {
  keyword: string;
  device: string;
  locationCode: number;
  languageCode: string;
}) => `${r.keyword}|${r.device}|${r.locationCode}|${r.languageCode}`;

export async function insertRankChecks(ch: ClickHouseClient, rows: readonly RankCheckRow[]) {
  if (!rows.length) return;
  await ch.insert({
    table: 'rank_history',
    format: 'JSONEachRow',
    values: rows.map((r) => ({
      project_id: r.projectId,
      keyword: r.keyword,
      device: r.device,
      location_code: r.locationCode,
      language_code: r.languageCode,
      date: r.date,
      position: r.position,
      url: r.url,
      volume: r.volume,
      serp_features: r.serpFeatures,
      volatility: r.volatility,
      top_urls: r.topUrls,
      checked_at: toDateTime64(r.checkedAt),
    })),
  });
}

export async function insertCompetitorRanks(
  ch: ClickHouseClient,
  rows: readonly CompetitorRankRow[],
) {
  if (!rows.length) return;
  await ch.insert({
    table: 'rank_competitor_history',
    format: 'JSONEachRow',
    values: rows.map((r) => ({
      project_id: r.projectId,
      keyword: r.keyword,
      device: r.device,
      location_code: r.locationCode,
      language_code: r.languageCode,
      date: r.date,
      domain: r.domain,
      position: r.position,
      url: r.url,
      checked_at: toDateTime64(r.checkedAt),
    })),
  });
}

export interface StoredRank {
  keyword: string;
  device: Device;
  locationCode: number;
  languageCode: string;
  date: string;
  position: number | null;
  url: string;
  volume: number;
  serpFeatures: string[];
  volatility: number;
  topUrls: string[];
}

interface RankDbRow {
  keyword: string;
  device: Device;
  location_code: number;
  language_code: string;
  day: string;
  position: number | null;
  url: string;
  volume: number;
  serp_features: string[];
  volatility: number;
  top_urls: string[];
}

/** Daily rank history of a project since `fromDate` (latest check per day), oldest first. */
export async function rankHistory(
  ch: ClickHouseClient,
  projectId: string,
  fromDate: string,
  opts: { keywords?: readonly string[]; withTopUrls?: boolean } = {},
): Promise<StoredRank[]> {
  const res = await ch.query({
    query: `SELECT keyword, device, location_code, language_code, toString(date) AS day,
                   argMax(tuple(position), checked_at).1 AS position, argMax(url, checked_at) AS url,
                   argMax(volume, checked_at) AS volume, argMax(serp_features, checked_at) AS serp_features,
                   argMax(volatility, checked_at) AS volatility,
                   ${opts.withTopUrls ? 'argMax(top_urls, checked_at)' : "CAST([], 'Array(String)')"} AS top_urls
            FROM rank_history
            WHERE project_id = {project:UUID} AND date >= {from:Date}
              ${opts.keywords ? 'AND keyword IN {keywords:Array(String)}' : ''}
            GROUP BY keyword, device, location_code, language_code, date
            ORDER BY date`,
    query_params: { project: projectId, from: fromDate, keywords: opts.keywords ?? [] },
    format: 'JSONEachRow',
  });
  return (await res.json<RankDbRow>()).map((r) => ({
    keyword: r.keyword,
    device: r.device,
    locationCode: Number(r.location_code),
    languageCode: r.language_code,
    date: r.day,
    position: r.position === null ? null : Number(r.position),
    url: r.url,
    volume: Number(r.volume),
    serpFeatures: r.serp_features,
    volatility: Number(r.volatility),
    topUrls: r.top_urls,
  }));
}

/** Latest check before `beforeDate` for each series of a project (previous position, top URLs). */
export async function previousRanks(
  ch: ClickHouseClient,
  projectId: string,
  beforeDate: string,
): Promise<Map<string, StoredRank>> {
  const res = await ch.query({
    query: `SELECT keyword, device, location_code, language_code,
                   toString(argMax(date, checked_at)) AS day,
                   argMax(tuple(position), checked_at).1 AS position, argMax(url, checked_at) AS url,
                   argMax(volume, checked_at) AS volume, argMax(serp_features, checked_at) AS serp_features,
                   argMax(volatility, checked_at) AS volatility, argMax(top_urls, checked_at) AS top_urls
            FROM rank_history
            WHERE project_id = {project:UUID} AND date < {before:Date}
              AND date >= {before:Date} - 60
            GROUP BY keyword, device, location_code, language_code`,
    query_params: { project: projectId, before: beforeDate },
    format: 'JSONEachRow',
  });
  const out = new Map<string, StoredRank>();
  for (const r of await res.json<RankDbRow>()) {
    const row: StoredRank = {
      keyword: r.keyword,
      device: r.device,
      locationCode: Number(r.location_code),
      languageCode: r.language_code,
      date: r.day,
      position: r.position === null ? null : Number(r.position),
      url: r.url,
      volume: Number(r.volume),
      serpFeatures: r.serp_features,
      volatility: Number(r.volatility),
      topUrls: r.top_urls,
    };
    out.set(rankSeriesKey(row), row);
  }
  return out;
}

export interface StoredCompetitorRank {
  keyword: string;
  device: Device;
  locationCode: number;
  languageCode: string;
  date: string;
  domain: string;
  position: number | null;
}

/** Daily competitor positions of a project since `fromDate`, oldest first. */
export async function competitorRankHistory(
  ch: ClickHouseClient,
  projectId: string,
  fromDate: string,
  opts: { keywords?: readonly string[] } = {},
): Promise<StoredCompetitorRank[]> {
  const res = await ch.query({
    query: `SELECT keyword, device, location_code, language_code, toString(date) AS day, domain,
                   argMax(tuple(position), checked_at).1 AS position
            FROM rank_competitor_history
            WHERE project_id = {project:UUID} AND date >= {from:Date}
              ${opts.keywords ? 'AND keyword IN {keywords:Array(String)}' : ''}
            GROUP BY keyword, device, location_code, language_code, date, domain
            ORDER BY date`,
    query_params: { project: projectId, from: fromDate, keywords: opts.keywords ?? [] },
    format: 'JSONEachRow',
  });
  return (
    await res.json<{
      keyword: string;
      device: Device;
      location_code: number;
      language_code: string;
      day: string;
      domain: string;
      position: number | null;
    }>()
  ).map((r) => ({
    keyword: r.keyword,
    device: r.device,
    locationCode: Number(r.location_code),
    languageCode: r.language_code,
    date: r.day,
    domain: r.domain,
    position: r.position === null ? null : Number(r.position),
  }));
}
