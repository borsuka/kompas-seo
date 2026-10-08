import type { Backlink, BacklinkSummary, ReferringDomain } from '@seo/shared';
import type { ClickHouseClient } from './client.js';

/**
 * ClickHouse access for backlink snapshots (parameterized queries only). Every row of a
 * snapshot carries the same updated_at, so reading a snapshot = rows with that timestamp
 * (older rows of earlier snapshots are ignored even before ReplacingMergeTree merges).
 */

const toDateTime64 = (d: Date) => d.toISOString().replace('T', ' ').replace('Z', '');
const toDateTime = (iso: string) => iso.slice(0, 19).replace('T', ' ');
const fromDateTime = (v: string) => new Date(`${v.replace(' ', 'T')}Z`).toISOString();

export interface BacklinkSnapshot {
  target: string;
  fetchedAt: string;
  summary: BacklinkSummary;
  backlinks: Backlink[];
  referringDomains: ReferringDomain[];
}

export async function insertBacklinkSnapshot(
  ch: ClickHouseClient,
  snap: Omit<BacklinkSnapshot, 'fetchedAt'> & { fetchedAt: Date },
  provider: string,
) {
  const updated = toDateTime64(snap.fetchedAt);
  if (snap.backlinks.length)
    await ch.insert({
      table: 'backlinks',
      format: 'JSONEachRow',
      values: snap.backlinks.map((b) => ({
        source_url: b.sourceUrl,
        source_domain: b.sourceDomain,
        target_url: b.targetUrl,
        // Keyed by the researched target (a link to a subdomain still belongs to it).
        target_domain: snap.target,
        anchor: b.anchor,
        rel: b.rel,
        link_type: b.linkType,
        source_rating: Math.round(b.sourceRating),
        target_status: b.targetStatus,
        spam_score: b.spamScore === null ? null : Math.round(b.spamScore),
        first_seen: toDateTime(b.firstSeen),
        last_seen: toDateTime(b.lastSeen),
        lost_at: b.lostAt ? toDateTime(b.lostAt) : null,
        updated_at: updated,
      })),
    });
  if (snap.referringDomains.length)
    await ch.insert({
      table: 'referring_domains',
      format: 'JSONEachRow',
      values: snap.referringDomains.map((d) => ({
        target: snap.target,
        domain: d.domain,
        backlinks: d.backlinks,
        dofollow: d.dofollow,
        rating: Math.round(d.rating),
        spam_score: d.spamScore === null ? null : Math.round(d.spamScore),
        first_seen: toDateTime(d.firstSeen),
        last_seen: toDateTime(d.lastSeen),
        lost_at: d.lostAt ? toDateTime(d.lostAt) : null,
        updated_at: updated,
      })),
    });
  // The summary is written last: it marks the snapshot as complete.
  await ch.insert({
    table: 'backlink_summaries',
    format: 'JSONEachRow',
    values: [
      { target: snap.target, data: JSON.stringify(snap.summary), provider, updated_at: updated },
    ],
  });
}

interface BacklinkDbRow {
  source_url: string;
  source_domain: string;
  target_url: string;
  anchor: string;
  rel: Backlink['rel'];
  link_type: Backlink['linkType'];
  source_rating: number;
  target_status: number | null;
  spam_score: number | null;
  first_seen: string;
  last_seen: string;
  lost_at: string | null;
}

interface ReferringDomainDbRow {
  domain: string;
  backlinks: number;
  dofollow: number;
  rating: number;
  spam_score: number | null;
  first_seen: string;
  last_seen: string;
  lost_at: string | null;
}

/** Latest complete snapshot of a target within `maxAgeDays`, or null. */
export async function latestBacklinkSnapshot(
  ch: ClickHouseClient,
  target: string,
  maxAgeDays: number,
): Promise<BacklinkSnapshot | null> {
  const [head] = await ch
    .query({
      query: `SELECT data, toString(updated_at) AS fetched
              FROM backlink_summaries
              WHERE target = {target:String} AND updated_at >= now64(3) - toIntervalDay({days:UInt32})
              ORDER BY updated_at DESC LIMIT 1`,
      query_params: { target, days: maxAgeDays },
      format: 'JSONEachRow',
    })
    .then((r) => r.json<{ data: string; fetched: string }>());
  if (!head) return null;
  const params = { target, at: head.fetched };

  const links = await ch
    .query({
      query: `SELECT source_url, source_domain, target_url, anchor, rel, link_type, source_rating,
                     target_status, spam_score, toString(first_seen) AS first_seen,
                     toString(last_seen) AS last_seen, toString(lost_at) AS lost_at
              FROM backlinks
              WHERE target_domain = {target:String} AND updated_at = toDateTime64({at:String}, 3, 'UTC')
              ORDER BY source_rating DESC, source_url`,
      query_params: params,
      format: 'JSONEachRow',
    })
    .then((r) => r.json<BacklinkDbRow>());
  const domains = await ch
    .query({
      query: `SELECT domain, backlinks, dofollow, rating, spam_score,
                     toString(first_seen) AS first_seen, toString(last_seen) AS last_seen,
                     toString(lost_at) AS lost_at
              FROM referring_domains
              WHERE target = {target:String} AND updated_at = toDateTime64({at:String}, 3, 'UTC')
              ORDER BY rating DESC, domain`,
      query_params: params,
      format: 'JSONEachRow',
    })
    .then((r) => r.json<ReferringDomainDbRow>());

  return {
    target,
    fetchedAt: fromDateTime(head.fetched),
    summary: JSON.parse(head.data) as BacklinkSummary,
    backlinks: links.map((b) => ({
      sourceUrl: b.source_url,
      sourceDomain: b.source_domain,
      targetUrl: b.target_url,
      targetDomain: target,
      anchor: b.anchor,
      rel: b.rel,
      linkType: b.link_type,
      sourceRating: Number(b.source_rating),
      firstSeen: fromDateTime(b.first_seen),
      lastSeen: fromDateTime(b.last_seen),
      lostAt: b.lost_at ? fromDateTime(b.lost_at) : null,
      targetStatus: b.target_status === null ? null : Number(b.target_status),
      spamScore: b.spam_score === null ? null : Number(b.spam_score),
    })),
    referringDomains: domains.map((d) => ({
      domain: d.domain,
      backlinks: Number(d.backlinks),
      dofollow: Number(d.dofollow),
      rating: Number(d.rating),
      firstSeen: fromDateTime(d.first_seen),
      lastSeen: fromDateTime(d.last_seen),
      lostAt: d.lost_at ? fromDateTime(d.lost_at) : null,
      spamScore: d.spam_score === null ? null : Number(d.spam_score),
    })),
  };
}
