import { z } from 'zod';
import { keywordSchema } from '../keyword.js';
import { deviceSchema } from '../locale.js';
import { serpFeatureSchema } from './providers.js';
import { tagSchema } from './keywords.js';

const optionalInt = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.coerce.number().int().min(min).max(max).optional(),
  );

/** Tracked keywords are checked to this SERP depth; deeper = "not ranked". */
export const RANK_CHECK_DEPTH = 100;
/** Max keywords added in one request. */
export const MAX_TRACKED_KEYWORDS_PER_REQUEST = 500;

export const addTrackedKeywordsSchema = z.object({
  keywords: z.array(keywordSchema).min(1).max(MAX_TRACKED_KEYWORDS_PER_REQUEST),
  devices: z.array(deviceSchema).min(1).max(2).default(['desktop']),
  tags: z.array(tagSchema).max(20).default([]),
});
export type AddTrackedKeywordsInput = z.input<typeof addTrackedKeywordsSchema>;

export const updateTrackedKeywordSchema = z.object({ tags: z.array(tagSchema).max(20) });

export const removeTrackedKeywordsSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(5000),
});

export const RANKING_SORT = [
  'keyword',
  'position',
  'change1d',
  'change7d',
  'change30d',
  'best',
  'volume',
  'traffic',
] as const;

export const rankingsQuerySchema = z.object({
  device: deviceSchema.optional(),
  tag: tagSchema.optional(),
  q: z.string().trim().max(200).optional(),
  /** up/down: moved since the previous check; new: entered the top 100; lost: dropped out. */
  changes: z.enum(['up', 'down', 'new', 'lost']).optional(),
  minPosition: optionalInt(1, 100),
  maxPosition: optionalInt(1, 100),
  sort: z.enum(RANKING_SORT).default('position'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});
export type RankingsQuery = z.output<typeof rankingsQuerySchema>;

export const trackedKeywordRowSchema = z.object({
  id: z.string(),
  keyword: z.string(),
  device: deviceSchema,
  locationCode: z.number().int(),
  languageCode: z.string(),
  tags: z.array(z.string()),
  /** Latest checked position; null = not in the top 100 (or never checked). */
  position: z.number().int().nullable(),
  previousPosition: z.number().int().nullable(),
  /** Positive = moved up. null when either side is unranked. */
  change1d: z.number().int().nullable(),
  change7d: z.number().int().nullable(),
  change30d: z.number().int().nullable(),
  best: z.number().int().nullable(),
  url: z.string().nullable(),
  volume: z.number().int(),
  traffic: z.number(),
  serpFeatures: z.array(serpFeatureSchema),
  /** Positions of the last 30 checks (oldest first) for a sparkline. */
  history: z.array(z.number().int().nullable()),
  /** Latest positions of the project's competitors. */
  competitors: z.record(z.string(), z.number().int().nullable()),
  lastCheckedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type TrackedKeywordRow = z.infer<typeof trackedKeywordRowSchema>;

export const rankingsResponseSchema = z.object({
  items: z.array(trackedKeywordRowSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  tags: z.array(z.string()),
  competitors: z.array(z.string()),
  lastCheckedAt: z.string().nullable(),
  limit: z.object({ used: z.number().int(), max: z.number().int() }),
});
export type RankingsResponse = z.infer<typeof rankingsResponseSchema>;

export const rankingsSummaryQuerySchema = z.object({
  device: deviceSchema.optional(),
  tag: tagSchema.optional(),
  days: z.coerce.number().int().min(7).max(365).default(30),
});
export type RankingsSummaryQuery = z.output<typeof rankingsSummaryQuerySchema>;

const distributionSchema = z.object({
  top3: z.number().int(),
  top10: z.number().int(),
  top20: z.number().int(),
  top50: z.number().int(),
  top100: z.number().int(),
  notRanked: z.number().int(),
});
export type PositionDistribution = z.infer<typeof distributionSchema>;

const moverSchema = z.object({
  id: z.string(),
  keyword: z.string(),
  device: deviceSchema,
  position: z.number().int().nullable(),
  previousPosition: z.number().int().nullable(),
  change: z.number().int(),
});

export const rankingsSummarySchema = z.object({
  keywords: z.number().int(),
  ranked: z.number().int(),
  avgPosition: z.number().nullable(),
  /** 0–100 %: estimated clicks captured vs. ranking #1 for every keyword. */
  visibility: z.number(),
  visibilityChange: z.number().nullable(),
  improved: z.number().int(),
  declined: z.number().int(),
  distribution: distributionSchema,
  trend: z.array(
    z.object({
      date: z.string(),
      visibility: z.number(),
      avgPosition: z.number().nullable(),
      top3: z.number().int(),
      top10: z.number().int(),
      /** 0–10: how much the tracked SERPs moved since the previous day. */
      volatility: z.number(),
    }),
  ),
  shareOfVoice: z.array(
    z.object({ domain: z.string(), share: z.number(), isProject: z.boolean() }),
  ),
  sovTrend: z.array(z.object({ date: z.string(), shares: z.record(z.string(), z.number()) })),
  movers: z.object({ up: z.array(moverSchema), down: z.array(moverSchema) }),
  lastCheckedAt: z.string().nullable(),
});
export type RankingsSummary = z.infer<typeof rankingsSummarySchema>;

export const keywordHistoryQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(90),
});

export const keywordHistorySchema = z.object({
  id: z.string(),
  keyword: z.string(),
  device: deviceSchema,
  points: z.array(
    z.object({ date: z.string(), position: z.number().int().nullable(), url: z.string() }),
  ),
  competitors: z.array(
    z.object({
      domain: z.string(),
      points: z.array(z.object({ date: z.string(), position: z.number().int().nullable() })),
    }),
  ),
});
export type KeywordHistory = z.infer<typeof keywordHistorySchema>;

export const RANK_ALERT_TYPES = [
  'position_drop',
  'position_gain',
  'enter_top',
  'leave_top',
] as const;
export const rankAlertTypeSchema = z.enum(RANK_ALERT_TYPES);
export type RankAlertType = z.infer<typeof rankAlertTypeSchema>;

export const createRankAlertSchema = z.object({
  type: rankAlertTypeSchema,
  /** position_drop/gain: positions moved; enter_top/leave_top: the top N (e.g. 3, 10). */
  threshold: z.number().int().min(1).max(100),
  /** Only keywords with this tag (all keywords when omitted). */
  tag: tagSchema.nullable().optional(),
  emails: z.array(z.email().max(254)).min(1).max(10),
  enabled: z.boolean().default(true),
});
export type CreateRankAlertInput = z.input<typeof createRankAlertSchema>;
export const updateRankAlertSchema = createRankAlertSchema.partial();

export const rankAlertSchema = z.object({
  id: z.string(),
  type: rankAlertTypeSchema,
  threshold: z.number().int(),
  tag: z.string().nullable(),
  emails: z.array(z.string()),
  enabled: z.boolean(),
  createdAt: z.string(),
});
export type RankAlert = z.infer<typeof rankAlertSchema>;

export const rankAlertEventSchema = z.object({
  id: z.string(),
  alertId: z.string(),
  type: rankAlertTypeSchema,
  keyword: z.string(),
  device: deviceSchema,
  date: z.string(),
  previousPosition: z.number().int().nullable(),
  position: z.number().int().nullable(),
  notifiedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type RankAlertEvent = z.infer<typeof rankAlertEventSchema>;
