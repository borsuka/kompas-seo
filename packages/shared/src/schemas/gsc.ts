import { z } from 'zod';

export const gscConnectionSchema = z.object({
  /** Which data source a connection would use (`mock` without Google OAuth credentials). */
  provider: z.enum(['google', 'mock']),
  connected: z.boolean(),
  status: z.enum(['pending_site', 'active', 'error']).nullable(),
  siteUrl: z.string().nullable(),
  lastSyncAt: z.string().nullable(),
  lastError: z.string().nullable(),
  /** Latest day with data (Search Console lags 2–3 days). */
  dataUntil: z.string().nullable(),
});
export type GscConnection = z.infer<typeof gscConnectionSchema>;

export const gscSelectSiteSchema = z.object({ siteUrl: z.string().trim().min(1).max(2048) });

export const gscRangeQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(480).default(28),
});

export const gscPerformanceQuerySchema = gscRangeQuerySchema.extend({
  by: z.enum(['query', 'page']).default('query'),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});
export type GscPerformanceQuery = z.output<typeof gscPerformanceQuerySchema>;

const totals = z.object({
  clicks: z.number(),
  impressions: z.number(),
  ctr: z.number(),
  position: z.number().nullable(),
});

export const gscPerformanceSchema = z.object({
  from: z.string(),
  to: z.string(),
  totals,
  /** Same-length period right before `from` (for change indicators). */
  previous: totals,
  daily: z.array(
    z.object({
      date: z.string(),
      clicks: z.number(),
      impressions: z.number(),
      position: z.number(),
    }),
  ),
  rows: z.array(
    z.object({
      key: z.string(),
      clicks: z.number(),
      impressions: z.number(),
      ctr: z.number(),
      position: z.number(),
    }),
  ),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type GscPerformance = z.infer<typeof gscPerformanceSchema>;

export const cannibalizationSchema = z.object({
  from: z.string(),
  to: z.string(),
  issues: z.array(
    z.object({
      query: z.string(),
      clicks: z.number(),
      impressions: z.number(),
      severity: z.enum(['high', 'medium']),
      pages: z.array(
        z.object({
          page: z.string(),
          clicks: z.number(),
          impressions: z.number(),
          position: z.number(),
          share: z.number(),
        }),
      ),
    }),
  ),
});
export type Cannibalization = z.infer<typeof cannibalizationSchema>;

export const calibrationSchema = z.object({
  from: z.string(),
  to: z.string(),
  /** Real clicks ÷ our estimate; multiply estimates by it for this site. */
  factor: z.number(),
  sampleSize: z.number().int(),
  reliable: z.boolean(),
  source: z.enum(['rank_tracking', 'domain_keywords', 'none']),
  rows: z.array(
    z.object({
      keyword: z.string(),
      position: z.number().nullable(),
      volume: z.number(),
      estimatedClicks: z.number(),
      actualClicks: z.number(),
    }),
  ),
});
export type Calibration = z.infer<typeof calibrationSchema>;
