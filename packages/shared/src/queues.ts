import { z } from 'zod';

/** BullMQ queue names. Each queue has one worker processor in apps/worker. */
export const QUEUES = {
  system: 'system',
  credits: 'credits',
  keywords: 'keywords',
  rankings: 'rankings',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Job types tracked in the Postgres `jobs` table and visible to users. */
export const JOB_TYPES = [
  'system.demo-progress',
  'credits.monthly-grant',
  'keywords.cluster',
  'rankings.schedule',
  'rankings.check',
] as const;
export const jobTypeSchema = z.enum(JOB_TYPES);
export type JobType = z.infer<typeof jobTypeSchema>;

export const JOB_QUEUE: Record<JobType, QueueName> = {
  'system.demo-progress': QUEUES.system,
  'credits.monthly-grant': QUEUES.credits,
  'keywords.cluster': QUEUES.keywords,
  'rankings.schedule': QUEUES.rankings,
  'rankings.check': QUEUES.rankings,
};

export interface RankCheckJobInput {
  projectId: string;
  /** Limit the check to these tracked keywords (default: all of the project). */
  trackedKeywordIds?: string[];
  trigger: 'schedule' | 'manual';
  /** Credits charged up front by the API (manual checks); the worker charges scheduled ones. */
  creditsCharged: number;
}

export interface ClusterJobInput {
  listId: string;
  minSharedUrls: number;
  /** Credits charged up front; refunded if the job finally fails. */
  creditsCharged: number;
}

export const JOB_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
export const jobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof jobStatusSchema>;

/** Payload of every BullMQ job that is mirrored in the `jobs` table. */
export interface TrackedJobData<T = unknown> {
  jobId: string;
  orgId: string | null;
  input: T;
}

/** Message published on `jobProgressChannel(jobId)` (Redis pub/sub) and streamed over SSE. */
export const jobEventSchema = z.object({
  jobId: z.string(),
  status: jobStatusSchema,
  progress: z.number().min(0).max(100),
  message: z.string().optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export type JobEvent = z.infer<typeof jobEventSchema>;

export const jobProgressChannel = (jobId: string) => `jobs:progress:${jobId}`;
