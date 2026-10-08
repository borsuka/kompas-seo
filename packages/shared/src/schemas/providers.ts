import { z } from 'zod';
import { deviceSchema } from '../locale.js';

/** Data types returned by `@seo/data-providers`. Provider-agnostic. */

export const INTENTS = ['informational', 'navigational', 'commercial', 'transactional'] as const;
export const intentSchema = z.enum(INTENTS);
export type Intent = z.infer<typeof intentSchema>;

export const SERP_FEATURES = [
  'ai_overview',
  'featured_snippet',
  'people_also_ask',
  'local_pack',
  'shopping',
  'images',
  'videos',
  'top_stories',
  'knowledge_panel',
  'sitelinks',
  'reviews',
  'top_ads',
  'bottom_ads',
  'related_searches',
] as const;
export const serpFeatureSchema = z.enum(SERP_FEATURES);
export type SerpFeature = z.infer<typeof serpFeatureSchema>;

export const monthlyVolumeSchema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  volume: z.number().int().min(0),
});
export type MonthlyVolume = z.infer<typeof monthlyVolumeSchema>;

export const competitionLevelSchema = z.enum(['low', 'medium', 'high']);

export const keywordMetricsSchema = z.object({
  keyword: z.string(),
  locationCode: z.number().int(),
  languageCode: z.string(),
  volume: z.number().int().min(0),
  /** Cost per click in USD (as returned by Google Ads based providers). */
  cpc: z.number().min(0).nullable(),
  /** Paid competition 0–1. */
  competition: z.number().min(0).max(1).nullable(),
  competitionLevel: competitionLevelSchema.nullable(),
  /** Oldest first, up to 24 months. */
  trend: z.array(monthlyVolumeSchema),
  /** Provider supplied difficulty; our own KD (seo-core) may override it. */
  kd: z.number().min(0).max(100).nullable(),
  intent: z.array(intentSchema),
  serpFeatures: z.array(serpFeatureSchema),
  updatedAt: z.string(),
});
export type KeywordMetrics = z.infer<typeof keywordMetricsSchema>;

export const IDEA_SOURCES = ['matching', 'related', 'question', 'autocomplete'] as const;
export const ideaSourceSchema = z.enum(IDEA_SOURCES);
export type IdeaSource = z.infer<typeof ideaSourceSchema>;

export const keywordIdeaSchema = keywordMetricsSchema.extend({
  source: ideaSourceSchema,
});
export type KeywordIdea = z.infer<typeof keywordIdeaSchema>;

export const ideaOptionsSchema = z.object({
  sources: z
    .array(ideaSourceSchema)
    .min(1)
    .default([...IDEA_SOURCES]),
  limit: z.number().int().min(1).max(1000).default(200),
});
export type IdeaOptions = z.infer<typeof ideaOptionsSchema>;

export const SERP_ITEM_TYPES = [
  'organic',
  'paid',
  'featured_snippet',
  'people_also_ask',
  'ai_overview',
  'local_pack',
  'shopping',
  'images',
  'video',
  'top_stories',
  'knowledge_graph',
  'related_searches',
] as const;
export const serpItemTypeSchema = z.enum(SERP_ITEM_TYPES);
export type SerpItemType = z.infer<typeof serpItemTypeSchema>;

export const serpItemSchema = z.object({
  /** Absolute position across all SERP elements (1-based). */
  rankAbsolute: z.number().int().min(1),
  /** Position within its own type group, e.g. organic rank (1-based). */
  rankGroup: z.number().int().min(1),
  type: serpItemTypeSchema,
  url: z.string().nullable(),
  domain: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  /** Questions for PAA, cited URLs for AI Overview, etc. */
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type SerpItem = z.infer<typeof serpItemSchema>;

export const serpSnapshotSchema = z.object({
  keyword: z.string(),
  locationCode: z.number().int(),
  languageCode: z.string(),
  device: deviceSchema,
  depth: z.number().int(),
  checkedAt: z.string(),
  totalResults: z.number().int().nullable(),
  features: z.array(serpFeatureSchema),
  items: z.array(serpItemSchema),
});
export type SerpSnapshot = z.infer<typeof serpSnapshotSchema>;

export const pagingSchema = z.object({
  limit: z.number().int().min(1).max(1000).default(100),
  offset: z.number().int().min(0).default(0),
});
export type Paging = z.infer<typeof pagingSchema>;

export const domainKeywordSchema = z.object({
  domain: z.string(),
  keyword: z.string(),
  locationCode: z.number().int(),
  languageCode: z.string(),
  position: z.number().int().min(1),
  previousPosition: z.number().int().min(1).nullable(),
  url: z.string(),
  volume: z.number().int().min(0),
  cpc: z.number().min(0).nullable(),
  kd: z.number().min(0).max(100).nullable(),
  intent: z.array(intentSchema),
  serpFeatures: z.array(serpFeatureSchema),
  /** Provider's traffic estimate; our own estimate (seo-core) is computed separately. */
  estTraffic: z.number().min(0).nullable(),
});
export type DomainKeyword = z.infer<typeof domainKeywordSchema>;

export const competitorCandidateSchema = z.object({
  domain: z.string(),
  commonKeywords: z.number().int().min(0),
  domainKeywords: z.number().int().min(0),
  targetKeywords: z.number().int().min(0),
  avgPosition: z.number().min(1).nullable(),
  estTraffic: z.number().min(0).nullable(),
});
export type CompetitorCandidate = z.infer<typeof competitorCandidateSchema>;

export const backlinkSummarySchema = z.object({
  target: z.string(),
  backlinks: z.number().int().min(0),
  referringDomains: z.number().int().min(0),
  referringIps: z.number().int().min(0).nullable(),
  /** Provider domain rating 0–100. */
  rating: z.number().min(0).max(100),
  dofollow: z.number().int().min(0),
  nofollow: z.number().int().min(0),
  brokenBacklinks: z.number().int().min(0),
  updatedAt: z.string(),
});
export type BacklinkSummary = z.infer<typeof backlinkSummarySchema>;

export const LINK_RELS = ['follow', 'nofollow', 'ugc', 'sponsored'] as const;
export const linkRelSchema = z.enum(LINK_RELS);
export type LinkRel = z.infer<typeof linkRelSchema>;

export const LINK_TYPES = ['text', 'image', 'redirect', 'canonical', 'form', 'other'] as const;
export const linkTypeSchema = z.enum(LINK_TYPES);

export const backlinkSchema = z.object({
  sourceUrl: z.string(),
  sourceDomain: z.string(),
  targetUrl: z.string(),
  targetDomain: z.string(),
  anchor: z.string(),
  rel: linkRelSchema,
  linkType: linkTypeSchema,
  sourceRating: z.number().min(0).max(100),
  firstSeen: z.string(),
  lastSeen: z.string(),
  lostAt: z.string().nullable(),
  /** HTTP status of the target page when known (e.g. 404 → broken backlink). */
  targetStatus: z.number().int().nullable(),
});
export type Backlink = z.infer<typeof backlinkSchema>;

export const backlinkQuerySchema = pagingSchema.extend({
  status: z.enum(['live', 'lost', 'all']).default('live'),
  rel: linkRelSchema.optional(),
  /** Restrict to one backlink per referring domain. */
  onePerDomain: z.boolean().default(false),
});
export type BacklinkQuery = z.infer<typeof backlinkQuerySchema>;

export const referringDomainSchema = z.object({
  domain: z.string(),
  backlinks: z.number().int().min(0),
  dofollow: z.number().int().min(0),
  rating: z.number().min(0).max(100),
  firstSeen: z.string(),
  lastSeen: z.string(),
  lostAt: z.string().nullable(),
});
export type ReferringDomain = z.infer<typeof referringDomainSchema>;

export const domainKeywordQuerySchema = pagingSchema.extend({
  /** `live`: current rankings. `lost`: keywords the domain ranked for and dropped out of the top 100. */
  mode: z.enum(['live', 'lost']).default('live'),
});
export type DomainKeywordQuery = z.input<typeof domainKeywordQuerySchema>;

export const domainOverviewSchema = z.object({
  domain: z.string(),
  locationCode: z.number().int(),
  languageCode: z.string(),
  organicKeywords: z.number().int().min(0),
  top3: z.number().int().min(0),
  top10: z.number().int().min(0),
  top100: z.number().int().min(0),
  /** Provider's estimated monthly organic traffic (our own estimate is computed separately). */
  estTraffic: z.number().min(0),
  newKeywords: z.number().int().min(0),
  lostKeywords: z.number().int().min(0),
  /** Monthly history, oldest first. */
  history: z.array(
    z.object({
      year: z.number().int(),
      month: z.number().int().min(1).max(12),
      keywords: z.number().int().min(0),
      estTraffic: z.number().min(0),
    }),
  ),
  /** Organic presence per country (Google Ads location codes). */
  countries: z.array(
    z.object({
      locationCode: z.number().int(),
      keywords: z.number().int().min(0),
      estTraffic: z.number().min(0),
    }),
  ),
  updatedAt: z.string(),
});
export type DomainOverview = z.infer<typeof domainOverviewSchema>;
