/**
 * Keyword Difficulty (0–100) from the backlink strength of the current top 10.
 *
 * 1. Take unique referring domains to each top-10 page.
 * 2. Weighted median (positions 1–3 weigh more: the hardest spots to take).
 * 3. kd = clamp(round(a · ln(1 + median) + b), 0, 100), calibrated so that
 *    0 ref. domains ≈ 0, 10 ≈ 30, 100 ≈ 60, 1000+ ≈ 90  (a = 12.9, b = 0).
 * 4. Small correction for the average domain rating of the top 10 (±5 points).
 */

export interface KdConfig {
  a: number;
  b: number;
  /** Weight per position 1..10. */
  positionWeights: readonly number[];
  /** Points added per rating point above 50 (negative below). */
  ratingCorrectionPerPoint: number;
  maxRatingCorrection: number;
}

export const DEFAULT_KD_CONFIG: KdConfig = {
  a: 12.9,
  b: 0,
  positionWeights: [2, 2, 2, 1, 1, 1, 1, 1, 1, 1],
  ratingCorrectionPerPoint: 0.1,
  maxRatingCorrection: 5,
};

export interface TopResult {
  position: number;
  referringDomains: number;
  /** Domain rating 0–100 of the ranking domain, when known. */
  domainRating?: number | null;
}

/** Weighted median: smallest value whose cumulative weight reaches half of the total. */
export function weightedMedian(values: readonly { value: number; weight: number }[]): number {
  const items = values
    .filter((v) => v.weight > 0 && Number.isFinite(v.value))
    .sort((x, y) => x.value - y.value);
  if (!items.length) return 0;
  const total = items.reduce((s, v) => s + v.weight, 0);
  let acc = 0;
  for (const item of items) {
    acc += item.weight;
    if (acc >= total / 2) return item.value;
  }
  return items[items.length - 1]!.value;
}

export function normalizeKd(median: number, config: KdConfig = DEFAULT_KD_CONFIG): number {
  return Math.min(
    100,
    Math.max(0, Math.round(config.a * Math.log1p(Math.max(0, median)) + config.b)),
  );
}

export function keywordDifficulty(
  top: readonly TopResult[],
  config: KdConfig = DEFAULT_KD_CONFIG,
): number | null {
  const top10 = top.filter((r) => r.position >= 1 && r.position <= 10);
  if (!top10.length) return null;

  const median = weightedMedian(
    top10.map((r) => ({
      value: r.referringDomains,
      weight: config.positionWeights[r.position - 1] ?? 1,
    })),
  );
  let kd = normalizeKd(median, config);

  const ratings = top10
    .map((r) => r.domainRating)
    .filter((r): r is number => typeof r === 'number');
  if (ratings.length) {
    const avg = ratings.reduce((s, r) => s + r, 0) / ratings.length;
    const correction = Math.max(
      -config.maxRatingCorrection,
      Math.min(config.maxRatingCorrection, (avg - 50) * config.ratingCorrectionPerPoint),
    );
    kd = Math.min(100, Math.max(0, Math.round(kd + correction)));
  }
  return kd;
}
