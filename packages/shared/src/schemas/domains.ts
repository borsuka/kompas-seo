import { z } from 'zod';
import { domainSchema } from '../domain.js';
import { languageCodeSchema, locationCodeSchema } from '../locale.js';
import { intentSchema, serpFeatureSchema } from './providers.js';
import { keywordFiltersSchema } from './keywords.js';

const optionalInt = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.coerce.number().int().min(min).max(max).optional(),
  );

export const domainLocaleQuerySchema = z.object({
  domain: domainSchema,
  loc: z.coerce.number().int().pipe(locationCodeSchema).default(2100),
  lang: languageCodeSchema.default('bg'),
});
export type DomainLocaleQuery = z.output<typeof domainLocaleQuerySchema>;

export const domainKeywordRowSchema = z.object({
  keyword: z.string(),
  position: z.number().int(),
  previousPosition: z.number().int().nullable(),
  /** previous − current (positive = moved up); null when new. */
  change: z.number().int().nullable(),
  url: z.string(),
  volume: z.number().int(),
  kd: z.number().nullable(),
  cpc: z.number().nullable(),
  intent: z.array(intentSchema),
  serpFeatures: z.array(serpFeatureSchema),
  /** Our estimate: volume × CTR(position). */
  traffic: z.number(),
});
export type DomainKeywordRow = z.infer<typeof domainKeywordRowSchema>;

export const topPageSchema = z.object({
  url: z.string(),
  keywords: z.number().int(),
  traffic: z.number(),
  topKeyword: z.string(),
  topKeywordVolume: z.number().int(),
  topKeywordPosition: z.number().int(),
});
export type TopPage = z.infer<typeof topPageSchema>;

export const domainOverviewResponseSchema = z.object({
  domain: z.string(),
  locationCode: z.number().int(),
  languageCode: z.string(),
  organicKeywords: z.number().int(),
  top3: z.number().int(),
  top10: z.number().int(),
  top100: z.number().int(),
  /** Provider's traffic estimate. */
  providerTraffic: z.number(),
  /** Our estimate from the stored keywords (Σ volume × CTR). */
  estTraffic: z.number(),
  newKeywords: z.number().int(),
  lostKeywords: z.number().int(),
  rating: z.number().nullable(),
  referringDomains: z.number().int().nullable(),
  backlinks: z.number().int().nullable(),
  history: z.array(
    z.object({
      year: z.number().int(),
      month: z.number().int(),
      keywords: z.number().int(),
      estTraffic: z.number(),
    }),
  ),
  countries: z.array(
    z.object({
      locationCode: z.number().int(),
      keywords: z.number().int(),
      estTraffic: z.number(),
    }),
  ),
  topKeywords: z.array(domainKeywordRowSchema),
  topPages: z.array(topPageSchema),
  fetchedAt: z.string(),
  creditsCharged: z.number().int(),
});
export type DomainOverviewResponse = z.infer<typeof domainOverviewResponseSchema>;

export const DOMAIN_KEYWORD_SORT = [
  'traffic',
  'position',
  'volume',
  'kd',
  'cpc',
  'keyword',
  'change',
] as const;

export const domainKeywordsQuerySchema = domainLocaleQuerySchema
  .extend(keywordFiltersSchema.shape)
  .extend({
    minPosition: optionalInt(1, 100),
    maxPosition: optionalInt(1, 100),
    url: z.string().max(2048).optional(),
    /** `new`: newly ranking keywords; `lost`: keywords that dropped out. */
    changes: z.enum(['new', 'lost']).optional(),
    sort: z.enum(DOMAIN_KEYWORD_SORT).default('traffic'),
    dir: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(50),
  });
export type DomainKeywordsQuery = z.output<typeof domainKeywordsQuerySchema>;

export const domainPagesQuerySchema = domainLocaleQuerySchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

export const competitorDiscoverySchema = z.object({
  domain: z.string(),
  keywordsAnalyzed: z.number().int(),
  competitors: z.array(
    z.object({
      domain: z.string(),
      commonKeywords: z.number().int(),
      /** Total keywords of the competitor (from the provider); null when unknown. */
      domainKeywords: z.number().int().nullable(),
      competitionLevel: z.number(),
      tracked: z.boolean(),
    }),
  ),
  creditsCharged: z.number().int(),
});
export type CompetitorDiscovery = z.infer<typeof competitorDiscoverySchema>;

export const GAP_TABS = ['missing', 'weak', 'strong', 'untapped', 'unique', 'shared'] as const;
export const gapTabSchema = z.enum(GAP_TABS);
export type GapTab = z.infer<typeof gapTabSchema>;

const competitorsCsv = z.preprocess(
  (v) =>
    (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [])
      .map((s) => String(s).trim())
      .filter(Boolean),
  z.array(domainSchema).min(1).max(4),
);

export const keywordGapQuerySchema = z
  .object({
    target: domainSchema,
    competitors: competitorsCsv,
    loc: z.coerce.number().int().pipe(locationCodeSchema).default(2100),
    lang: languageCodeSchema.default('bg'),
    tab: gapTabSchema.default('missing'),
    sort: z.enum(['volume', 'kd', 'cpc', 'keyword']).default('volume'),
    dir: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(50),
  })
  .extend(keywordFiltersSchema.shape);
export type KeywordGapQuery = z.output<typeof keywordGapQuerySchema>;

export const keywordGapRowSchema = z.object({
  keyword: z.string(),
  volume: z.number().int(),
  kd: z.number().nullable(),
  cpc: z.number().nullable(),
  intent: z.array(intentSchema),
  serpFeatures: z.array(serpFeatureSchema),
  wordCount: z.number().int(),
  positions: z.record(z.string(), z.number().int().nullable()),
});
export type KeywordGapRow = z.infer<typeof keywordGapRowSchema>;

export const keywordGapResponseSchema = z.object({
  domains: z.array(z.string()),
  counts: z.record(gapTabSchema, z.number().int()),
  items: z.array(keywordGapRowSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  creditsCharged: z.number().int(),
});
export type KeywordGapResponse = z.infer<typeof keywordGapResponseSchema>;

export const contentGapQuerySchema = z.object({
  target: domainSchema,
  competitors: competitorsCsv,
  loc: z.coerce.number().int().pipe(locationCodeSchema).default(2100),
  lang: languageCodeSchema.default('bg'),
  minCompetitors: z.coerce.number().int().min(1).max(4).default(1),
});
export type ContentGapQuery = z.output<typeof contentGapQuerySchema>;

export const contentGapResponseSchema = z.object({
  topics: z.array(
    z.object({
      topic: z.string(),
      pages: z.array(z.object({ domain: z.string(), url: z.string(), traffic: z.number() })),
      keywords: z.number().int(),
      totalVolume: z.number().int(),
      totalTraffic: z.number(),
      competitors: z.number().int(),
    }),
  ),
  creditsCharged: z.number().int(),
});
export type ContentGapResponse = z.infer<typeof contentGapResponseSchema>;
