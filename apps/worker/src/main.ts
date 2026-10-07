import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { ClickHouseUsageSink, createProviders, RedisCacheStore } from '@seo/data-providers';
import { createDb } from '@seo/db';
import { clickHouseConfigFromEnv, createClickHouse } from '@seo/db/clickhouse';
import { JOB_QUEUE, QUEUES, type JobType, type QueueName } from '@seo/shared';
import { loadRootEnv, parseEnv, workerEnvSchema } from '@seo/shared/server';
import { startHealthServer } from './health.js';
import { PROCESSORS } from './processors/index.js';
import { tracked, type WorkerDeps } from './runtime.js';

loadRootEnv();
const env = parseEnv(workerEnvSchema);

const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'worker' },
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } }
      : undefined,
});

const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
redis.on('error', (err) => logger.error({ err }, 'redis error'));
const { db, close: closeDb } = createDb(env.DATABASE_URL, { max: 10 });
const clickhouse = createClickHouse(clickHouseConfigFromEnv(env));
const usage = new ClickHouseUsageSink(clickhouse, {
  onError: (err) => logger.error({ err }, 'failed to write provider usage'),
});
const providers = createProviders({
  env,
  cache: new RedisCacheStore(redis),
  usage,
  logger: { warn: (obj, msg) => logger.warn(obj, msg) },
});
const deps: WorkerDeps = { db, redis, clickhouse, providers, logger };

/** Concurrency per queue: CPU-light I/O bound jobs can run in parallel. */
const CONCURRENCY: Record<QueueName, number> = { system: 5, credits: 1 };

const workers = (Object.values(QUEUES) as QueueName[]).map((queueName) => {
  const worker = new Worker(
    queueName,
    async (job) => {
      const processor = PROCESSORS[job.name as JobType];
      if (!processor || JOB_QUEUE[job.name as JobType] !== queueName) {
        throw new Error(`No processor for job "${job.name}" on queue "${queueName}"`);
      }
      return tracked(deps, processor as never)(job);
    },
    { connection: redis.duplicate(), concurrency: CONCURRENCY[queueName] },
  );
  worker.on('error', (err) => logger.error({ err, queue: queueName }, 'worker error'));
  return worker;
});

// Scheduled jobs (idempotent upserts: safe on every start, across replicas).
const creditsQueue = new Queue(QUEUES.credits, { connection: redis });
await creditsQueue.upsertJobScheduler(
  'credits.monthly-grant',
  { pattern: '0 5 1 * *', tz: 'UTC' },
  {
    name: 'credits.monthly-grant',
    data: {},
    opts: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 } },
  },
);

let running = true;
const health = startHealthServer(env.WORKER_HEALTH_PORT, deps, () => running);
logger.info({ queues: Object.values(QUEUES), port: env.WORKER_HEALTH_PORT }, 'worker started');

async function shutdown(signal: string) {
  if (!running) return;
  running = false;
  logger.info({ signal }, 'shutting down');
  await Promise.allSettled(workers.map((w) => w.close()));
  await creditsQueue.close();
  await usage.flush();
  health.close();
  await Promise.allSettled([closeDb(), clickhouse.close()]);
  redis.disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
