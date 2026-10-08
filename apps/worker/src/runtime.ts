import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { updateJob, type Database } from '@seo/db';
import type { ClickHouseClient } from '@seo/db/clickhouse';
import type { ProviderSet } from '@seo/data-providers';
import {
  jobProgressChannel,
  type JobEvent,
  type JobStatus,
  type TrackedJobData,
} from '@seo/shared';

export interface WorkerDeps {
  db: Database;
  redis: Redis;
  clickhouse: ClickHouseClient;
  providers: ProviderSet;
  logger: Logger;
}

export interface JobContext {
  /** Reports progress 0–100 (persisted + streamed to the UI). */
  progress(value: number, message?: string): Promise<void>;
  logger: Logger;
  deps: WorkerDeps;
  /** BullMQ attempt number (1-based). */
  attempt: number;
  /** True when a failure now will not be retried (time to compensate, e.g. refund). */
  isFinalAttempt: boolean;
  /** Organization the job runs for (null for system jobs). */
  orgId: string | null;
}

export type Processor<TInput = unknown, TResult = unknown> = (
  input: TInput,
  ctx: JobContext,
) => Promise<TResult>;

/**
 * Wraps a processor with tracking: mirrors status/progress into the `jobs` table and
 * publishes every change on Redis for SSE subscribers. Jobs without `jobId` (e.g.
 * scheduled system jobs) run untracked.
 */
export function tracked(deps: WorkerDeps, processor: Processor) {
  return async (job: Job<Partial<TrackedJobData>>) => {
    const jobId = job.data.jobId;
    const logger = deps.logger.child({ job: job.name, jobId: jobId ?? job.id });
    const maxAttempts = job.opts.attempts ?? 1;

    const publish = async (event: Omit<JobEvent, 'jobId'>) => {
      if (!jobId) return;
      await deps.redis.publish(jobProgressChannel(jobId), JSON.stringify({ jobId, ...event }));
    };
    const set = async (status: JobStatus, patch: Parameters<typeof updateJob>[2] = {}) => {
      if (!jobId) return;
      await updateJob(deps.db, jobId, { status, ...patch });
    };

    let lastProgress = 0;
    const ctx: JobContext = {
      logger,
      deps,
      attempt: job.attemptsMade + 1,
      isFinalAttempt: job.attemptsMade + 1 >= maxAttempts,
      orgId: job.data.orgId ?? null,
      progress: async (value, message) => {
        lastProgress = Math.max(0, Math.min(100, value));
        await set('running', { progress: lastProgress, message: message ?? null });
        await publish({ status: 'running', progress: lastProgress, message });
      },
    };

    await set('running', { error: null });
    await publish({ status: 'running', progress: lastProgress });
    try {
      const result = await processor(job.data.input ?? job.data, ctx);
      await set('completed', { progress: 100, result: result ?? null, message: null });
      await publish({ status: 'completed', progress: 100, result });
      logger.info('job completed');
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const final = job.attemptsMade + 1 >= maxAttempts;
      if (final) {
        await set('failed', { error: message });
        await publish({ status: 'failed', progress: lastProgress, error: message });
      } else {
        await set('queued', { message: `Retrying after error: ${message}` });
        await publish({ status: 'queued', progress: lastProgress, message });
      }
      logger.error({ err, final }, 'job failed');
      throw err;
    }
  };
}
