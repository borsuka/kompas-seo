/**
 * Organic click-through-rate curve by position, with SERP feature adjustments.
 * All numbers are configurable; defaults follow the product spec.
 */

export interface CtrConfig {
  /** CTR for positions 1–10. */
  top10: readonly number[];
  /** CTR at position 100; positions 11–100 decay exponentially from top10[9] to this. */
  ctrAt100: number;
  /** Multipliers applied when the SERP has these features. */
  adjustments: {
    aiOverview: number;
    featuredSnippetOtherDomain: number;
    /** Applied when there are at least `minTopAds` ads above organic results. */
    topAds: number;
    minTopAds: number;
  };
}

export const DEFAULT_CTR_CONFIG: CtrConfig = {
  top10: [0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018],
  ctrAt100: 0.0005,
  adjustments: {
    aiOverview: 0.7,
    featuredSnippetOtherDomain: 0.85,
    topAds: 0.9,
    minTopAds: 3,
  },
};

export interface SerpContext {
  aiOverview?: boolean;
  /** A featured snippet exists and belongs to a different domain than the ranking URL. */
  featuredSnippetOtherDomain?: boolean;
  /** Number of paid results above the organic results. */
  topAds?: number;
}

/** Base CTR for an organic position (1-based). Positions > 100 or < 1 get 0. */
export function baseCtr(position: number, config: CtrConfig = DEFAULT_CTR_CONFIG): number {
  if (!Number.isFinite(position) || position < 1 || position > 100) return 0;
  const p = Math.round(position);
  if (p <= config.top10.length) return config.top10[p - 1]!;
  const last = config.top10[config.top10.length - 1]!;
  const start = config.top10.length;
  // Smooth exponential decay: ctr(start) = last, ctr(100) = ctrAt100.
  const lambda = (100 - start) / Math.log(last / config.ctrAt100);
  return last * Math.exp(-(p - start) / lambda);
}

/** CTR after SERP feature adjustments (multiplicative). */
export function ctr(
  position: number,
  serp: SerpContext = {},
  config: CtrConfig = DEFAULT_CTR_CONFIG,
): number {
  let value = baseCtr(position, config);
  if (serp.aiOverview) value *= config.adjustments.aiOverview;
  if (serp.featuredSnippetOtherDomain) value *= config.adjustments.featuredSnippetOtherDomain;
  if ((serp.topAds ?? 0) >= config.adjustments.minTopAds) value *= config.adjustments.topAds;
  return value;
}
