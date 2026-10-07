import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';

const updates: { id: string; patch: Record<string, unknown> }[] = [];
vi.mock('@seo/db', () => ({
  updateJob: vi.fn(async (_db: unknown, id: string, patch: Record<string, unknown>) => {
    updates.push({ id, patch });
  }),
}));

const { tracked } = await import('./runtime.js');
const { demoProgress } = await import('./processors/system.js');

function fakeDeps() {
  const published: { channel: string; event: Record<string, unknown> }[] = [];
  const logger = { child: () => logger, info: vi.fn(), error: vi.fn(), warn: vi.fn() };
  return {
    published,
    deps: {
      db: {},
      redis: {
        publish: vi.fn(async (channel: string, msg: string) => {
          published.push({ channel, event: JSON.parse(msg) });
          return 1;
        }),
      },
      clickhouse: {},
      providers: {},
      logger,
    } as never,
  };
}

const job = (data: unknown, attemptsMade = 0, attempts = 1) =>
  ({
    id: 'bull-1',
    name: 'system.demo-progress',
    data,
    attemptsMade,
    opts: { attempts },
  }) as unknown as Job;

describe('tracked job runner', () => {
  it('mirrors progress to the jobs table and publishes events until completion', async () => {
    updates.length = 0;
    const { deps, published } = fakeDeps();
    const result = await tracked(
      deps,
      demoProgress as never,
    )(job({ jobId: 'job-1', orgId: 'org-1', input: { steps: 2, delayMs: 1 } }));
    expect(result).toEqual({ steps: 2 });
    expect(published.map((p) => p.event.status)).toEqual([
      'running',
      'running',
      'running',
      'completed',
    ]);
    expect(published.map((p) => p.event.progress)).toEqual([0, 50, 100, 100]);
    expect(published.every((p) => p.channel === 'jobs:progress:job-1')).toBe(true);
    expect(updates.at(-1)).toMatchObject({
      id: 'job-1',
      patch: { status: 'completed', progress: 100 },
    });
  });

  it('marks the job failed only after the final attempt', async () => {
    updates.length = 0;
    const { deps, published } = fakeDeps();
    const failing = async () => {
      throw new Error('boom');
    };
    await expect(tracked(deps, failing)(job({ jobId: 'job-2', input: {} }, 0, 3))).rejects.toThrow(
      'boom',
    );
    expect(updates.at(-1)?.patch.status).toBe('queued');
    await expect(tracked(deps, failing)(job({ jobId: 'job-2', input: {} }, 2, 3))).rejects.toThrow(
      'boom',
    );
    expect(updates.at(-1)?.patch).toMatchObject({ status: 'failed', error: 'boom' });
    expect(published.at(-1)?.event).toMatchObject({ status: 'failed', error: 'boom' });
  });

  it('runs untracked jobs (scheduled system jobs) without touching the jobs table', async () => {
    updates.length = 0;
    const { deps, published } = fakeDeps();
    const processor = vi.fn(async () => 'ok');
    await expect(tracked(deps, processor)(job({}))).resolves.toBe('ok');
    expect(updates).toHaveLength(0);
    expect(published).toHaveLength(0);
  });
});
