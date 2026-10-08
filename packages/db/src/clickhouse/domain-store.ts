import type { DomainKeyword, DomainOverview, Locale } from '@seo/shared';
import type { ClickHouseClient } from './client.js';

/** ClickHouse access for domain research snapshots (parameterized queries only). */

const today = () => new Date().toISOString().slice(0, 10);
const now64 = () => new Date().toISOString().replace('T', ' ').replace('Z', '');

export type SnapshotMode = 'live' | 'lost';

export async function insertDomainKeywords(
  ch: ClickHouseClient,
  rows: readonly DomainKeyword[],
  mode: SnapshotMode,
) {
  if (!rows.length) return;
  const date = today();
  const updated = now64();
  await ch.insert({
    table: 'domain_keywords',
    format: 'JSONEachRow',
    values: rows.map((r) => ({
      domain: r.domain,
      keyword: r.keyword,
      location_code: r.locationCode,
      language_code: r.languageCode,
      date,
      mode,
      position: r.position,
      previous_position: r.previousPosition,
      url: r.url,
      volume: r.volume,
      cpc: r.cpc,
      kd: r.kd === null ? null : Math.round(r.kd),
      intent: r.intent,
      serp_features: r.serpFeatures,
      est_traffic: r.estTraffic ?? 0,
      updated_at: updated,
    })),
  });
}

interface DomainKeywordRow {
  domain: string;
  keyword: string;
  location_code: number;
  language_code: string;
  position: number;
  previous_position: number | null;
  url: string;
  volume: number;
  cpc: number | null;
  kd: number | null;
  intent: string[];
  serp_features: string[];
  est_traffic: number;
}

/**
 * Rows of the most recent snapshot (within `maxAgeDays`) for one domain + locale + mode.
 * Returns null when there is no fresh snapshot.
 */
export async function latestDomainKeywords(
  ch: ClickHouseClient,
  domain: string,
  loc: Locale,
  mode: SnapshotMode,
  maxAgeDays: number,
): Promise<DomainKeyword[] | null> {
  const params = { domain, loc: loc.locationCode, lang: loc.languageCode, mode, days: maxAgeDays };
  const res = await ch.query({
    query: `SELECT domain, keyword, location_code, language_code, position, previous_position, url, volume,
                   cpc, kd, intent, serp_features, est_traffic
            FROM domain_keywords FINAL
            WHERE domain = {domain:String} AND location_code = {loc:UInt32} AND language_code = {lang:String}
              AND mode = {mode:String}
              AND date = (
                SELECT max(date) FROM domain_keywords
                WHERE domain = {domain:String} AND location_code = {loc:UInt32} AND language_code = {lang:String}
                  AND mode = {mode:String} AND date >= today() - {days:UInt32}
              )`,
    query_params: params,
    format: 'JSONEachRow',
  });
  const rows = await res.json<DomainKeywordRow>();
  if (!rows.length) {
    // An empty-but-fresh snapshot is recorded in domain_overviews; callers decide.
    return null;
  }
  return rows.map((r) => ({
    domain: r.domain,
    keyword: r.keyword,
    locationCode: r.location_code,
    languageCode: r.language_code,
    position: r.position,
    previousPosition: r.previous_position,
    url: r.url,
    volume: r.volume,
    cpc: r.cpc,
    kd: r.kd,
    intent: r.intent as DomainKeyword['intent'],
    serpFeatures: r.serp_features as DomainKeyword['serpFeatures'],
    estTraffic: r.est_traffic,
  }));
}

/** Stored extra data next to the provider overview (our estimates, backlink metrics). */
export interface StoredDomainOverview {
  overview: DomainOverview;
  rating: number | null;
  referringDomains: number | null;
  backlinks: number | null;
}

export async function insertDomainOverview(
  ch: ClickHouseClient,
  data: StoredDomainOverview,
  provider: string,
) {
  await ch.insert({
    table: 'domain_overviews',
    format: 'JSONEachRow',
    values: [
      {
        domain: data.overview.domain,
        location_code: data.overview.locationCode,
        language_code: data.overview.languageCode,
        date: today(),
        data: JSON.stringify(data),
        provider,
        updated_at: now64(),
      },
    ],
  });
}

export async function latestDomainOverview(
  ch: ClickHouseClient,
  domain: string,
  loc: Locale,
  maxAgeDays: number,
): Promise<(StoredDomainOverview & { date: string }) | null> {
  const res = await ch.query({
    query: `SELECT data, date FROM domain_overviews FINAL
            WHERE domain = {domain:String} AND location_code = {loc:UInt32} AND language_code = {lang:String}
              AND date >= today() - {days:UInt32}
            ORDER BY date DESC LIMIT 1`,
    query_params: { domain, loc: loc.locationCode, lang: loc.languageCode, days: maxAgeDays },
    format: 'JSONEachRow',
  });
  const [row] = await res.json<{ data: string; date: string }>();
  return row ? { ...(JSON.parse(row.data) as StoredDomainOverview), date: row.date } : null;
}
