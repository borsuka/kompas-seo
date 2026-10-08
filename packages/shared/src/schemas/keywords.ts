import { z } from 'zod';
import { keywordSchema } from '../keyword.js';
import { deviceSchema, languageCodeSchema, locationCodeSchema } from '../locale.js';
import {
  ideaSourceSchema,
  intentSchema,
  keywordMetricsSchema,
  serpFeatureSchema,
  type Intent,
  type SerpFeature,
} from './providers.js';

/** Comma separated query param → string[] (accepts repeated params too). */
const csv = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (v) =>
      (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [])
        .map((s) => String(s).trim())
        .filter(Boolean),
    z.array(item).max(50),
  );

const optionalNumber = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.number().min(min).max(max).optional(),
  );

export const localeQuerySchema = z.object({
  loc: z.coerce.number().int().pipe(locationCodeSchema).default(2100),
  lang: languageCodeSchema.default('bg'),
});

// --- Explorer --------------------------------------------------------------------

export const KEYWORD_SORT_FIELDS = [
  'volume',
  'kd',
  'cpc',
  'competition',
  'wordCount',
  'keyword',
] as const;
export const keywordSortFieldSchema = z.enum(KEYWORD_SORT_FIELDS);

/** Server-side filters shared by the explorer and keyword lists. */
export const keywordFiltersSchema = z.object({
  minVolume: optionalNumber(0, 1e9),
  maxVolume: optionalNumber(0, 1e9),
  minKd: optionalNumber(0, 100),
  maxKd: optionalNumber(0, 100),
  minCpc: optionalNumber(0, 1e4),
  maxCpc: optionalNumber(0, 1e4),
  minWords: optionalNumber(1, 50),
  maxWords: optionalNumber(1, 50),
  intents: csv(intentSchema).default([]),
  /** Every term must appear in the keyword. */
  include: csv(z.string().max(100)).default([]),
  /** No term may appear in the keyword. */
  exclude: csv(z.string().max(100)).default([]),
  /** Keyword's SERP must have all of these features. */
  features: csv(serpFeatureSchema).default([]),
});
export type KeywordFilters = z.output<typeof keywordFiltersSchema>;

export const keywordSortSchema = z.object({
  sort: keywordSortFieldSchema.default('volume'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

export const explorerQuerySchema = localeQuerySchema
  .extend(keywordFiltersSchema.shape)
  .extend(keywordSortSchema.shape)
  .extend({
    q: keywordSchema,
    /** Restrict to one idea source tab; empty = all. */
    source: ideaSourceSchema.optional(),
  });
export type ExplorerQuery = z.output<typeof explorerQuerySchema>;

export const keywordRowSchema = z.object({
  keyword: z.string(),
  volume: z.number().int(),
  cpc: z.number().nullable(),
  competition: z.number().nullable(),
  kd: z.number().nullable(),
  intent: z.array(intentSchema),
  serpFeatures: z.array(serpFeatureSchema),
  wordCount: z.number().int(),
  /** Last 12 monthly volumes, oldest first (for sparklines). */
  trend: z.array(z.number().int()),
  source: ideaSourceSchema.nullable(),
});
export type KeywordRow = z.infer<typeof keywordRowSchema>;

export const explorerResponseSchema = z.object({
  seed: z.string(),
  locationCode: z.number().int(),
  languageCode: z.string(),
  items: z.array(keywordRowSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  /** Counts per source for the tabs, ignoring the `source` filter. */
  sourceCounts: z.record(z.string(), z.number().int()),
  fetchedAt: z.string(),
  /** Credits spent by this request (0 when served from stored data). */
  creditsCharged: z.number().int(),
});
export type ExplorerResponse = z.infer<typeof explorerResponseSchema>;

// --- Overview --------------------------------------------------------------------

export const overviewQuerySchema = localeQuerySchema.extend({
  q: keywordSchema,
  device: deviceSchema.default('desktop'),
});
export type OverviewQuery = z.output<typeof overviewQuerySchema>;

export const serpResultSchema = z.object({
  position: z.number().int(),
  url: z.string(),
  domain: z.string(),
  title: z.string().nullable(),
  referringDomains: z.number().int().nullable(),
  backlinks: z.number().int().nullable(),
  domainRating: z.number().nullable(),
  /** Estimated monthly clicks from this keyword alone. */
  estTraffic: z.number(),
});
export type SerpResult = z.infer<typeof serpResultSchema>;

export const keywordOverviewSchema = z.object({
  metrics: keywordMetricsSchema,
  /** Our KD from the top-10 backlink profile when computed, else the provider's. */
  kd: z.number().nullable(),
  kdSource: z.enum(['computed', 'provider', 'none']),
  parentTopic: z.string().nullable(),
  /** Estimated traffic of the #1 page across all keywords it ranks for. */
  trafficPotential: z.number().int().nullable(),
  serp: z.object({
    checkedAt: z.string(),
    device: deviceSchema,
    totalResults: z.number().nullable(),
    features: z.array(serpFeatureSchema),
    results: z.array(serpResultSchema),
    peopleAlsoAsk: z.array(z.string()),
    aiOverviewReferences: z.array(z.string()),
  }),
  creditsCharged: z.number().int(),
});
export type KeywordOverview = z.infer<typeof keywordOverviewSchema>;

// --- Keyword lists ------------------------------------------------------------------

export const tagSchema = z.string().trim().min(1).max(40);

export const createKeywordListSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  tags: z.array(tagSchema).max(20).default([]),
  locationCode: locationCodeSchema.default(2100),
  languageCode: languageCodeSchema.default('bg'),
  projectId: z.uuid().optional(),
});
export type CreateKeywordListInput = z.input<typeof createKeywordListSchema>;

export const updateKeywordListSchema = createKeywordListSchema
  .pick({ name: true, description: true, tags: true })
  .partial();

export const keywordListSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  locationCode: z.number().int(),
  languageCode: z.string(),
  projectId: z.string().nullable(),
  itemCount: z.number().int(),
  clusteredAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type KeywordList = z.infer<typeof keywordListSchema>;

export const addListItemsSchema = z.object({
  keywords: z.array(keywordSchema).min(1).max(1000),
  tags: z.array(tagSchema).max(20).default([]),
});
export type AddListItemsInput = z.input<typeof addListItemsSchema>;

export const updateListItemSchema = z.object({
  note: z.string().trim().max(2000).nullable().optional(),
  tags: z.array(tagSchema).max(20).optional(),
});

export const removeListItemsSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(1000),
});

export const listItemsQuerySchema = keywordFiltersSchema.extend(keywordSortSchema.shape).extend({
  cluster: z.string().max(200).optional(),
  tag: z.string().max(40).optional(),
});
export type ListItemsQuery = z.output<typeof listItemsQuerySchema>;

export const keywordListItemSchema = keywordRowSchema.omit({ source: true }).extend({
  id: z.string(),
  note: z.string().nullable(),
  tags: z.array(z.string()),
  cluster: z.string().nullable(),
  addedAt: z.string(),
});
export type KeywordListItem = z.infer<typeof keywordListItemSchema>;

export const clusterSummarySchema = z.object({
  name: z.string(),
  keywords: z.number().int(),
  totalVolume: z.number().int(),
});
export type ClusterSummary = z.infer<typeof clusterSummarySchema>;

export const clusterOptionsSchema = z.object({
  minSharedUrls: z.number().int().min(1).max(10).default(3),
});

export const EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export const exportQuerySchema = z.object({ format: z.enum(EXPORT_FORMATS).default('csv') });

export type { Intent, SerpFeature };
