import { ctr, DEFAULT_CTR_CONFIG, type CtrConfig, type SerpContext } from './ctr.js';

export interface RankingRow {
  keyword: string;
  url: string;
  volume: number;
  position: number;
  serp?: SerpContext;
}

/** traffic(kw) = volume × ctr(position, serp features) */
export function keywordTraffic(row: RankingRow, config: CtrConfig = DEFAULT_CTR_CONFIG): number {
  if (row.volume <= 0) return 0;
  return row.volume * ctr(row.position, row.serp, config);
}

/** traffic(url) = Σ volume(kw) × ctr(position(kw), serpFeatures(kw)) */
export function trafficByUrl(
  rows: readonly RankingRow[],
  config: CtrConfig = DEFAULT_CTR_CONFIG,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) out.set(row.url, (out.get(row.url) ?? 0) + keywordTraffic(row, config));
  return out;
}

/** Domain traffic: sum over all its URLs. */
export function domainTraffic(
  rows: readonly RankingRow[],
  config: CtrConfig = DEFAULT_CTR_CONFIG,
): number {
  let total = 0;
  for (const row of rows) total += keywordTraffic(row, config);
  return total;
}

export interface Calibration {
  /** real clicks / estimated clicks over the keywords both sources know. */
  factor: number;
  /** Keywords used for the calibration. */
  sampleSize: number;
  reliable: boolean;
}

/**
 * Calibration against Google Search Console: factor = Σ real clicks / Σ estimated clicks
 * over matching keywords. Clamped to [0.1, 10] to avoid absurd results from tiny samples.
 */
export function calibrationFactor(
  pairs: readonly { estimatedClicks: number; actualClicks: number }[],
  minSample = 20,
): Calibration {
  const usable = pairs.filter((p) => p.estimatedClicks > 0 && p.actualClicks >= 0);
  const est = usable.reduce((s, p) => s + p.estimatedClicks, 0);
  const act = usable.reduce((s, p) => s + p.actualClicks, 0);
  if (est <= 0) return { factor: 1, sampleSize: usable.length, reliable: false };
  const factor = Math.min(10, Math.max(0.1, act / est));
  return { factor, sampleSize: usable.length, reliable: usable.length >= minSample };
}
