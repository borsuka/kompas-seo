import { z } from 'zod';
import { keywordSchema } from '../keyword.js';
import { languageCodeSchema, locationCodeSchema } from '../locale.js';

/** Aggregated top-10 analysis (mirrors seo-core `ContentAnalysis`). */
export const contentAnalysisSchema = z.object({
  pagesAnalyzed: z.number().int(),
  wordCount: z.object({
    median: z.number(),
    p25: z.number(),
    p75: z.number(),
    recommendedMin: z.number(),
    recommendedMax: z.number(),
  }),
  headings: z.object({ medianH2: z.number(), medianH3: z.number() }),
  topics: z.array(z.object({ heading: z.string(), pages: z.number().int() })),
  terms: z.array(
    z.object({
      term: z.string(),
      pages: z.number().int(),
      coverage: z.number(),
      avgCount: z.number(),
    }),
  ),
  keywordInTitle: z.number(),
  keywordInH1: z.number(),
  titleLength: z.number(),
  metaDescriptionLength: z.number(),
  medianImages: z.number(),
  schemaTypes: z.array(z.object({ type: z.string(), pages: z.number().int() })),
});
export type ContentAnalysisDto = z.infer<typeof contentAnalysisSchema>;

export const analyzedPageSummarySchema = z.object({
  url: z.string(),
  position: z.number().int(),
  title: z.string().nullable(),
  wordCount: z.number().int(),
  h1: z.string().nullable(),
  /** null when the page was analysed; otherwise why it was skipped. */
  skipped: z
    .enum([
      'robots',
      'blocked',
      'http_error',
      'noindex',
      'timeout',
      'too_large',
      'too_many_redirects',
      'unsupported_content',
      'network',
    ])
    .nullable(),
});
export type AnalyzedPageSummary = z.infer<typeof analyzedPageSummarySchema>;

/** The writer-facing brief. Produced by Claude, or by a deterministic template without a key. */
export const contentBriefSchema = z.object({
  titleOptions: z.array(z.string()).min(1).max(5),
  metaDescription: z.string(),
  h1: z.string(),
  searchIntent: z.string(),
  wordCount: z.object({ min: z.number().int(), max: z.number().int() }),
  outline: z.array(
    z.object({
      heading: z.string(),
      level: z.union([z.literal(2), z.literal(3)]),
      points: z.array(z.string()),
    }),
  ),
  keyTerms: z.array(z.string()),
  questions: z.array(z.string()),
  notes: z.array(z.string()),
});
export type ContentBrief = z.infer<typeof contentBriefSchema>;

export const BRIEF_STATUSES = ['queued', 'running', 'ready', 'failed'] as const;
export const briefStatusSchema = z.enum(BRIEF_STATUSES);

export const createBriefSchema = z.object({
  keyword: keywordSchema,
  loc: z.coerce.number().int().pipe(locationCodeSchema).default(2100),
  lang: languageCodeSchema.default('bg'),
  projectId: z.uuid().optional(),
});
export type CreateBriefInput = z.input<typeof createBriefSchema>;

export const briefSchema = z.object({
  id: z.string(),
  keyword: z.string(),
  locationCode: z.number().int(),
  languageCode: z.string(),
  projectId: z.string().nullable(),
  status: briefStatusSchema,
  /** `ai` = written by Claude; `template` = built from the analysis without an LLM. */
  source: z.enum(['ai', 'template']).nullable(),
  jobId: z.string().nullable(),
  analysis: contentAnalysisSchema.nullable(),
  pages: z.array(analyzedPageSummarySchema),
  peopleAlsoAsk: z.array(z.string()),
  brief: contentBriefSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Brief = z.infer<typeof briefSchema>;

export const briefListItemSchema = briefSchema.pick({
  id: true,
  keyword: true,
  locationCode: true,
  languageCode: true,
  projectId: true,
  status: true,
  source: true,
  createdAt: true,
});
export type BriefListItem = z.infer<typeof briefListItemSchema>;

export interface BriefJobInput {
  briefId: string;
  /** Credits charged up front by the API; refunded if the job finally fails. */
  creditsCharged: number;
}
