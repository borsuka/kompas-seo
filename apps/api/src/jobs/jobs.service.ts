import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { defer, filter, from, map, merge, Observable, Subject, takeWhile } from 'rxjs';
import { findJob, insertJob, type Database, type JobRow } from '@seo/db';
import {
  AppError,
  JOB_QUEUE,
  jobEventSchema,
  jobProgressChannel,
  type Job,
  type JobEvent,
  type JobType,
  type TrackedJobData,
} from '@seo/shared';
import type { QueueMap } from '../infra/infra.module.js';
import { DB, QUEUES, REDIS } from '../infra/tokens.js';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export const toJob = (r: JobRow): Job => ({
  id: r.id,
  type: r.type,
  status: r.status,
  progress: r.progress,
  message: r.message,
  result: r.result ?? null,
  error: r.error,
  createdAt: r.createdAt.toISOString(),
  startedAt: r.startedAt?.toISOString() ?? null,
  finishedAt: r.finishedAt?.toISOString() ?? null,
});

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private subscriber: Redis | null = null;
  private readonly events = new Subject<JobEvent>();

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(QUEUES) private readonly queues: QueueMap,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onModuleInit() {
    this.subscriber = this.redis.duplicate();
    await this.subscriber.psubscribe(jobProgressChannel('*'));
    this.subscriber.on('pmessage', (_pattern, _channel, message) => {
      const parsed = jobEventSchema.safeParse(JSON.parse(message));
      if (parsed.success) this.events.next(parsed.data);
    });
  }

  async onModuleDestroy() {
    this.events.complete();
    this.subscriber?.disconnect();
  }

  /** Creates the tracking row and enqueues the BullMQ job with the same id. */
  async enqueue<T>(
    type: JobType,
    input: T,
    ctx: { organizationId: string; userId: string },
  ): Promise<Job> {
    const row = await insertJob(this.db, {
      organizationId: ctx.organizationId,
      createdBy: ctx.userId,
      type,
      input,
    });
    const data: TrackedJobData<T> = { jobId: row.id, orgId: ctx.organizationId, input };
    await this.queues[JOB_QUEUE[type]].add(type, data, {
      jobId: row.id,
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
    return toJob(row);
  }

  async get(organizationId: string, id: string): Promise<Job> {
    const row = /^[0-9a-f-]{36}$/i.test(id) ? await findJob(this.db, organizationId, id) : null;
    if (!row) throw new AppError('NOT_FOUND', 'Job not found');
    return toJob(row);
  }

  /** Current state first, then live updates until the job finishes. */
  stream(organizationId: string, id: string): Observable<{ data: JobEvent }> {
    const live = this.events.pipe(filter((e) => e.jobId === id));
    const initial = defer(() => from(this.get(organizationId, id))).pipe(
      map((job): JobEvent => ({
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        message: job.message ?? undefined,
        result: job.result ?? undefined,
        error: job.error ?? undefined,
      })),
    );
    return merge(initial, live).pipe(
      takeWhile((e) => !TERMINAL.has(e.status), true),
      map((data) => ({ data })),
    );
  }
}
