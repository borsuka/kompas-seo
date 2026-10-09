import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { updateJob, type Database } from '@seo/db';
import type { ClickHouseClient } from '@seo/db/clickhouse';
import type { Crawler } from '@seo/crawler';
import type { GoogleOAuth, GscClient, ProviderSet } from '@seo/data-providers';
import type { LLMProvider } from '@seo/llm';
import {
  jobProgressChannel,
  type CreditCost,
  type JobEvent,
  type JobStatus,
  type JobType,
  type ProviderOperation,
  type TrackedJobData,
} from '@seo/shared';
import type { Mailer } from './mailer.js';

export interface WorkerDeps {
  db: Database;
  redis: Redis;
  clickhouse: ClickHouseClient;
  providers: ProviderSet;
  logger: Logger;
  mailer: Mailer;
  /** Public web URL for links in emails. */
  appUrl: string;
  creditCosts: Record<ProviderOperation, CreditCost>;
  llm: LLMProvider;
  crawler: Crawler;
  /** Search Console: Google client + OAuth (when configured) and the mock. */
  gsc: { google: GscClient; mock: GscClient; oauth: GoogleOAuth | null };
  /** For decrypting stored OAuth tokens. */
  encryptionKey: string;
  /**
   * Creates a tracked job (jobs row + BullMQ job) from inside the worker. With `dedupeKey`,
   * a job with the same key that is still queued or running is reused (returns null).
   */
  enqueue: <T>(
    type: JobType,
    input: T,
    opts: { organizationId: string | null; dedupeKey?: string },
  ) => Promise<string | null>;
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
    // Progress writes are serialized and ignored once the job has finished, so a late
    // (fire-and-forget) progress update can never overwrite the final status.
    let finished = false;
    let chain: Promise<void> = Promise.resolve();
    const ctx: JobContext = {
      logger,
      deps,
      attempt: job.attemptsMade + 1,
      isFinalAttempt: job.attemptsMade + 1 >= maxAttempts,
      orgId: job.data.orgId ?? null,
      progress: (value, message) => {
        chain = chain
          .then(async () => {
            if (finished) return;
            lastProgress = Math.max(0, Math.min(100, value));
            await set('running', { progress: lastProgress, message: message ?? null });
            await publish({ status: 'running', progress: lastProgress, message });
          })
          .catch((err: unknown) => logger.warn({ err }, 'progress update failed'));
        return chain;
      },
    };

    await set('running', { error: null });
    await publish({ status: 'running', progress: lastProgress });
    try {
      const result = await processor(job.data.input ?? job.data, ctx);
      finished = true;
      await chain;
      await set('completed', { progress: 100, result: result ?? null, message: null });
      await publish({ status: 'completed', progress: 100, result });
      logger.info('job completed');
      return result;
    } catch (err) {
      finished = true;
      await chain;
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
