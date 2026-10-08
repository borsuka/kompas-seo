import { z } from 'zod';
import { domainSchema } from '../domain.js';
import { competitorsCsv } from './domains.js';
import { backlinkSummarySchema, linkRelSchema, referringDomainSchema } from './providers.js';

const page = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
};
const dir = z.enum(['asc', 'desc']).default('desc');

export const backlinkTargetQuerySchema = z.object({ target: domainSchema });

export const ANCHOR_TYPES = ['branded', 'url', 'generic', 'empty', 'other'] as const;
export const anchorTypeSchema = z.enum(ANCHOR_TYPES);
export type AnchorTypeName = z.infer<typeof anchorTypeSchema>;

export const anchorRowSchema = z.object({
  anchor: z.string(),
  type: anchorTypeSchema,
  backlinks: z.number().int(),
  referringDomains: z.number().int(),
  dofollow: z.number().int(),
});
export type AnchorRowDto = z.infer<typeof anchorRowSchema>;

export const toxicitySchema = z.object({
  score: z.number(),
  level: z.enum(['low', 'medium', 'high']),
  reasons: z.array(
    z.enum([
      'provider_spam_score',
      'spammy_tld',
      'spammy_words',
      'no_authority',
      'link_farm',
      'ip_address',
      'all_nofollow',
    ]),
  ),
});
export type ToxicityDto = z.infer<typeof toxicitySchema>;

export const backlinkOverviewSchema = z.object({
  target: z.string(),
  summary: backlinkSummarySchema,
  /** New and lost referring domains per month (from the stored sample). */
  newLost: z.array(z.object({ month: z.string(), new: z.number().int(), lost: z.number().int() })),
  anchors: z.array(anchorRowSchema),
  anchorTypes: z.record(anchorTypeSchema, z.number().int()),
  rel: z.record(linkRelSchema, z.number().int()),
  tlds: z.array(z.object({ tld: z.string(), domains: z.number().int() })),
  topReferringDomains: z.array(referringDomainSchema),
  /** Rows analysed in this snapshot (providers return the strongest first). */
  sample: z.object({ backlinks: z.number().int(), referringDomains: z.number().int() }),
  fetchedAt: z.string(),
  creditsCharged: z.number().int(),
});
export type BacklinkOverview = z.infer<typeof backlinkOverviewSchema>;

export const backlinksListQuerySchema = backlinkTargetQuerySchema.extend({
  /** new = first seen in the last 30 days; broken = target page returns 4xx/5xx. */
  status: z.enum(['all', 'live', 'lost', 'new', 'broken']).default('live'),
  rel: linkRelSchema.optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(['rating', 'firstSeen', 'lastSeen', 'spamScore']).default('rating'),
  dir,
  ...page,
});
export type BacklinksListQuery = z.output<typeof backlinksListQuerySchema>;

export const referringDomainsQuerySchema = backlinkTargetQuerySchema.extend({
  status: z.enum(['all', 'live', 'lost', 'new']).default('live'),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(['rating', 'backlinks', 'firstSeen', 'spamScore']).default('rating'),
  dir,
  ...page,
});
export type ReferringDomainsQuery = z.output<typeof referringDomainsQuerySchema>;

export const anchorsQuerySchema = backlinkTargetQuerySchema.extend({
  type: anchorTypeSchema.optional(),
  q: z.string().trim().max(200).optional(),
  ...page,
});
export type AnchorsQuery = z.output<typeof anchorsQuerySchema>;

export const linkGapQuerySchema = z.object({
  target: domainSchema,
  competitors: competitorsCsv,
  minCompetitors: z.coerce.number().int().min(1).max(4).default(1),
  /** Hide prospects whose toxicity is high. */
  hideToxic: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  ...page,
});
export type LinkGapQuery = z.output<typeof linkGapQuerySchema>;

export const linkGapRowSchema = z.object({
  domain: z.string(),
  rating: z.number(),
  spamScore: z.number().nullable(),
  links: z.record(z.string(), z.number().int()),
  competitors: z.number().int(),
});
export type LinkGapRowDto = z.infer<typeof linkGapRowSchema>;

export const linkGapResponseSchema = z.object({
  domains: z.array(z.string()),
  items: z.array(linkGapRowSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  creditsCharged: z.number().int(),
});
export type LinkGapResponse = z.infer<typeof linkGapResponseSchema>;

export const toxicQuerySchema = z.object({
  level: z.enum(['all', 'medium', 'high']).default('medium'),
  disavowed: z.enum(['all', 'yes', 'no']).default('all'),
  ...page,
});
export type ToxicQuery = z.output<typeof toxicQuerySchema>;

export const toxicDomainSchema = referringDomainSchema.extend({
  toxicity: toxicitySchema,
  disavowed: z.boolean(),
});
export type ToxicDomain = z.infer<typeof toxicDomainSchema>;

export const toxicResponseSchema = z.object({
  domain: z.string(),
  items: z.array(toxicDomainSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  counts: z.object({ low: z.number().int(), medium: z.number().int(), high: z.number().int() }),
  disavowed: z.number().int(),
  fetchedAt: z.string(),
  creditsCharged: z.number().int(),
});
export type ToxicResponse = z.infer<typeof toxicResponseSchema>;

export const DISAVOW_TYPES = ['domain', 'url'] as const;
const disavowValue = z.string().trim().min(1).max(2048);

export const addDisavowSchema = z.object({
  entries: z
    .array(
      z.object({
        type: z.enum(DISAVOW_TYPES),
        value: disavowValue,
        reason: z.string().trim().max(300).nullable().optional(),
      }),
    )
    .min(1)
    .max(1000),
});
export type AddDisavowInput = z.input<typeof addDisavowSchema>;

export const removeDisavowSchema = z.object({ ids: z.array(z.uuid()).min(1).max(5000) });

export const disavowEntrySchema = z.object({
  id: z.string(),
  type: z.enum(DISAVOW_TYPES),
  value: z.string(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type DisavowEntryDto = z.infer<typeof disavowEntrySchema>;
