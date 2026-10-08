import { z } from 'zod';

/** Every metered call to an external data source is one of these operations. */
export const PROVIDER_OPERATIONS = [
  'keyword.metrics',
  'keyword.ideas',
  'serp.get',
  'domain.keywords',
  'domain.competitors',
  'domain.overview',
  'backlink.summary',
  'backlink.list',
  'backlink.referringDomains',
  /** Keyword Overview: backlink + ranking metrics of the top-10 pages (one composite charge). */
  'serp.pageMetrics',
  /** SERP top 10 fetched for clustering, per keyword without a stored SERP. */
  'keyword.clusterSerp',
  /** One rank check of a tracked keyword (SERP top 100). */
  'rank.check',
] as const;
export const providerOperationSchema = z.enum(PROVIDER_OPERATIONS);
export type ProviderOperation = z.infer<typeof providerOperationSchema>;

/**
 * cost = base + ceil(units / unitSize) * perUnit
 * `units` is operation specific (keywords requested, SERP depth / 100, rows requested / 100…).
 */
export interface CreditCost {
  base: number;
  perUnit: number;
  unitSize: number;
}

export const DEFAULT_CREDIT_COSTS: Record<ProviderOperation, CreditCost> = {
  'keyword.metrics': { base: 0, perUnit: 1, unitSize: 10 },
  'keyword.ideas': { base: 10, perUnit: 0, unitSize: 1 },
  'serp.get': { base: 0, perUnit: 5, unitSize: 100 },
  'domain.keywords': { base: 5, perUnit: 1, unitSize: 100 },
  'domain.competitors': { base: 10, perUnit: 0, unitSize: 1 },
  'domain.overview': { base: 5, perUnit: 0, unitSize: 1 },
  'backlink.summary': { base: 5, perUnit: 0, unitSize: 1 },
  'backlink.list': { base: 5, perUnit: 1, unitSize: 100 },
  'backlink.referringDomains': { base: 5, perUnit: 1, unitSize: 100 },
  'serp.pageMetrics': { base: 10, perUnit: 0, unitSize: 1 },
  'keyword.clusterSerp': { base: 0, perUnit: 1, unitSize: 1 },
  'rank.check': { base: 0, perUnit: 1, unitSize: 1 },
};

const creditCostSchema = z.object({
  base: z.number().int().min(0),
  perUnit: z.number().int().min(0),
  unitSize: z.number().int().min(1),
});

export const creditCostOverridesSchema = z.partialRecord(
  providerOperationSchema,
  z.union([z.number().int().min(0), creditCostSchema.partial()]),
);

/**
 * Merges defaults with an override JSON (e.g. from `CREDIT_COSTS_JSON`).
 * A bare number overrides `base` and zeroes `perUnit` ("flat price").
 */
export function resolveCreditCosts(
  overridesJson?: string | null,
): Record<ProviderOperation, CreditCost> {
  const costs = structuredClone(DEFAULT_CREDIT_COSTS);
  if (!overridesJson?.trim()) return costs;
  const overrides = creditCostOverridesSchema.parse(JSON.parse(overridesJson));
  for (const [op, value] of Object.entries(overrides) as [ProviderOperation, unknown][]) {
    if (typeof value === 'number') costs[op] = { base: value, perUnit: 0, unitSize: 1 };
    else if (value) costs[op] = { ...costs[op], ...(value as Partial<CreditCost>) };
  }
  return costs;
}

export function computeCreditCost(cost: CreditCost, units = 1): number {
  const u = Math.max(0, units);
  return cost.base + Math.ceil(u / cost.unitSize) * cost.perUnit;
}

export const CREDIT_REASONS = [
  'plan_grant',
  'manual_adjustment',
  'provider_usage',
  'refund',
  'signup_bonus',
] as const;
export const creditReasonSchema = z.enum(CREDIT_REASONS);
export type CreditReason = z.infer<typeof creditReasonSchema>;
