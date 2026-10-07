import { z } from 'zod';

/** BullMQ queue names. Each queue has one worker processor in apps/worker. */
export const QUEUES = {
  system: 'system',
  credits: 'credits',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Job types tracked in the Postgres `jobs` table and visible to users. */
export const JOB_TYPES = ['system.demo-progress', 'credits.monthly-grant'] as const;
export const jobTypeSchema = z.enum(JOB_TYPES);
export type JobType = z.infer<typeof jobTypeSchema>;

export const JOB_QUEUE: Record<JobType, QueueName> = {
  'system.demo-progress': QUEUES.system,
  'credits.monthly-grant': QUEUES.credits,
};

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
