/**
 * Rank tracking metrics: visibility, share of voice, distribution, SERP volatility
 * and alert detection. Positions are 1-based; null = not ranked within the checked depth.
 */
import { baseCtr, DEFAULT_CTR_CONFIG, type CtrConfig } from './ctr.js';

export interface RankedKeyword {
  position: number | null;
  volume: number;
}

/** Expected clicks of one keyword at a position (volume × CTR, 0 when unranked). */
export function expectedClicks(
  position: number | null,
  volume: number,
  config: CtrConfig = DEFAULT_CTR_CONFIG,
): number {
  return position === null ? 0 : volume * baseCtr(position, config);
}

/**
 * Visibility 0–100 %: clicks captured relative to ranking #1 for every keyword.
 * Keywords without volume count as volume 1, so tiny keyword sets still move the needle.
 */
export function visibility(rows: readonly RankedKeyword[], config = DEFAULT_CTR_CONFIG): number {
  let got = 0;
  let max = 0;
  for (const r of rows) {
    const v = Math.max(1, r.volume);
    got += expectedClicks(r.position, v, config);
    max += v * baseCtr(1, config);
  }
  return max > 0 ? Math.round((got / max) * 10_000) / 100 : 0;
}

export function averagePosition(positions: readonly (number | null)[]): number | null {
  const ranked = positions.filter((p): p is number => p !== null);
  if (!ranked.length) return null;
  return Math.round((ranked.reduce((s, p) => s + p, 0) / ranked.length) * 10) / 10;
}

export interface Distribution {
  top3: number;
  top10: number;
  top20: number;
  top50: number;
  top100: number;
  notRanked: number;
}

/** Cumulative buckets (top10 includes top3), like most rank trackers report them. */
export function positionDistribution(positions: readonly (number | null)[]): Distribution {
  const d: Distribution = { top3: 0, top10: 0, top20: 0, top50: 0, top100: 0, notRanked: 0 };
  for (const p of positions) {
    if (p === null || p > 100) {
      d.notRanked++;
      continue;
    }
    if (p <= 3) d.top3++;
    if (p <= 10) d.top10++;
    if (p <= 20) d.top20++;
    if (p <= 50) d.top50++;
    d.top100++;
  }
  return d;
}

/**
 * Share of voice: each domain's expected clicks over the tracked keywords divided by the
 * clicks of all compared domains. Returns shares 0–1 that sum to 1 (or all 0).
 */
export function shareOfVoice(
  byDomain: ReadonlyMap<string, readonly RankedKeyword[]>,
  config = DEFAULT_CTR_CONFIG,
): Map<string, number> {
  const clicks = new Map<string, number>();
  for (const [domain, rows] of byDomain)
    clicks.set(
      domain,
      rows.reduce((s, r) => s + expectedClicks(r.position, Math.max(1, r.volume), config), 0),
    );
  const total = [...clicks.values()].reduce((s, v) => s + v, 0);
  return new Map(
    [...clicks.entries()].map(([d, c]) => [
      d,
      total > 0 ? Math.round((c / total) * 1000) / 1000 : 0,
    ]),
  );
}

/**
 * SERP volatility 0–10 between two checks of the same keyword: mean absolute position
 * change of the URLs in either top 10 (a URL that left the top 10 counts as position 11),
 * scaled so that a completely reshuffled SERP scores 10.
 */
export function serpVolatility(previous: readonly string[], current: readonly string[]): number {
  if (!previous.length || !current.length) return 0;
  const depth = 10;
  const pos = (list: readonly string[]) =>
    new Map(list.slice(0, depth).map((u, i) => [u, i + 1] as const));
  const a = pos(previous);
  const b = pos(current);
  const urls = new Set([...a.keys(), ...b.keys()]);
  let moved = 0;
  for (const u of urls) moved += Math.abs((a.get(u) ?? depth + 1) - (b.get(u) ?? depth + 1));
  // Two disjoint top 10s: every URL moves to/from position 11, on average (depth + 1) / 2.
  const max = (depth + 1) / 2;
  return Math.round(Math.min(10, (moved / urls.size / max) * 10) * 10) / 10;
}

/** Positive = improved (moved up). null when either side is unranked. */
export function positionChange(previous: number | null, current: number | null): number | null {
  if (previous === null || current === null) return null;
  return previous - current;
}

/** Position of the first organic result of a domain (or its subdomains) in an ordered SERP. */
export function findDomainPosition(
  organic: readonly { domain: string | null; url: string | null; position: number }[],
  domain: string,
): { position: number; url: string } | null {
  const d = domain.replace(/^www\./, '');
  for (const r of organic) {
    const host = (r.domain ?? '').replace(/^www\./, '');
    if (host === d || host.endsWith(`.${d}`)) return { position: r.position, url: r.url ?? '' };
  }
  return null;
}

export type AlertType = 'position_drop' | 'position_gain' | 'enter_top' | 'leave_top';

export interface AlertRule {
  id: string;
  type: AlertType;
  threshold: number;
}

/** Whether a change between two checks triggers an alert rule. Unranked = position 101. */
export function alertTriggered(
  rule: AlertRule,
  previous: number | null,
  current: number | null,
): boolean {
  const prev = previous ?? 101;
  const cur = current ?? 101;
  switch (rule.type) {
    case 'position_drop':
      return cur - prev >= rule.threshold;
    case 'position_gain':
      return prev - cur >= rule.threshold;
    case 'enter_top':
      return prev > rule.threshold && cur <= rule.threshold;
    case 'leave_top':
      return prev <= rule.threshold && cur > rule.threshold;
  }
}
