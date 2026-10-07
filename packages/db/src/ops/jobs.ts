import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { JobStatus, JobType } from '@seo/shared';
import type { DbExecutor } from '../client.js';
import { jobs } from '../schema/app.js';

export type JobRow = typeof jobs.$inferSelect;

export async function insertJob(
  db: DbExecutor,
  input: {
    organizationId: string | null;
    createdBy?: string | null;
    type: JobType;
    input: unknown;
  },
): Promise<JobRow> {
  const [row] = await db
    .insert(jobs)
    .values({
      organizationId: input.organizationId,
      createdBy: input.createdBy ?? null,
      type: input.type,
      input: input.input ?? null,
    })
    .returning();
  return row!;
}

/** Org-scoped lookup. `organizationId: null` matches only system jobs. */
export async function findJob(
  db: DbExecutor,
  organizationId: string | null,
  id: string,
): Promise<JobRow | null> {
  const orgFilter: SQL =
    organizationId === null ? isNull(jobs.organizationId) : eq(jobs.organizationId, organizationId);
  const [row] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), orgFilter));
  return row ?? null;
}

export async function updateJob(
  db: DbExecutor,
  id: string,
  patch: {
    status?: JobStatus;
    progress?: number;
    message?: string | null;
    result?: unknown;
    error?: string | null;
  },
): Promise<void> {
  const now = new Date();
  await db
    .update(jobs)
    .set({
      ...(patch.status && { status: patch.status }),
      ...(patch.progress !== undefined && {
        progress: Math.round(Math.min(100, Math.max(0, patch.progress))),
      }),
      ...(patch.message !== undefined && { message: patch.message }),
      ...(patch.result !== undefined && { result: patch.result }),
      ...(patch.error !== undefined && { error: patch.error }),
      ...(patch.status === 'running' && { startedAt: sql`coalesce(${jobs.startedAt}, ${now})` }),
      ...((patch.status === 'completed' ||
        patch.status === 'failed' ||
        patch.status === 'cancelled') && {
        finishedAt: now,
      }),
    })
    .where(eq(jobs.id, id));
}
