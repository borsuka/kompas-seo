import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { Crawler, type RobotsCache } from '@seo/crawler';
import {
  ClickHouseUsageSink,
  createProviders,
  GoogleGscClient,
  GoogleOAuth,
  MockGscClient,
  RedisCacheStore,
} from '@seo/data-providers';
import { AnthropicLLMProvider, DisabledLLMProvider } from '@seo/llm';
import { createDb, insertJob } from '@seo/db';
import { clickHouseConfigFromEnv, createClickHouse } from '@seo/db/clickhouse';
import {
  JOB_QUEUE,
  QUEUES,
  resolveCreditCosts,
  type JobType,
  type QueueName,
  type TrackedJobData,
} from '@seo/shared';
import { loadRootEnv, parseEnv, workerEnvSchema } from '@seo/shared/server';
import { startHealthServer } from './health.js';
import { createMailer } from './mailer.js';
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
const queues = Object.fromEntries(
  (Object.values(QUEUES) as QueueName[]).map((q) => [q, new Queue(q, { connection: redis })]),
) as Record<QueueName, Queue>;

/** robots.txt per origin, shared by all worker processes for a day. */
const robotsCache: RobotsCache = {
  get: (origin) => redis.get(`robots:${origin}`),
  set: async (origin, value, ttlSec) => {
    await redis.set(`robots:${origin}`, value, 'EX', ttlSec);
  },
};

const deps: WorkerDeps = {
  db,
  redis,
  clickhouse,
  providers,
  logger,
  mailer: createMailer(env),
  appUrl: env.APP_URL,
  creditCosts: resolveCreditCosts(env.CREDIT_COSTS_JSON),
  llm:
    env.ANTHROPIC_API_KEY && env.NODE_ENV !== 'test'
      ? new AnthropicLLMProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL)
      : new DisabledLLMProvider(),
  crawler: new Crawler(robotsCache),
  gsc: {
    google: new GoogleGscClient(),
    mock: new MockGscClient(),
    oauth:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? new GoogleOAuth({
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            redirectUri: `${env.APP_URL}/api/v1/integrations/gsc/callback`,
          })
        : null,
  },
  encryptionKey: env.ENCRYPTION_KEY,
  async enqueue(type, input, opts) {
    const queue = queues[JOB_QUEUE[type]];
    if (opts.dedupeKey) {
      const existing = await queue.getJob(opts.dedupeKey);
      if (existing && !(await existing.isCompleted()) && !(await existing.isFailed())) return null;
      // A finished job with the same key blocks re-adding under that id: remove it first.
      if (existing) await existing.remove();
    }
    const row = await insertJob(db, { organizationId: opts.organizationId, type, input });
    const data: TrackedJobData = { jobId: row.id, orgId: opts.organizationId, input };
    await queue.add(type, data, {
      jobId: opts.dedupeKey ?? row.id,
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
    return row.id;
  },
};

/** Concurrency per queue: CPU-light I/O bound jobs can run in parallel. */
const CONCURRENCY: Record<QueueName, number> = {
  system: 5,
  credits: 1,
  keywords: 3,
  rankings: 2,
  content: 2,
};

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
const creditsQueue = queues[QUEUES.credits];
await creditsQueue.upsertJobScheduler(
  'credits.monthly-grant',
  { pattern: '0 5 1 * *', tz: 'UTC' },
  {
    name: 'credits.monthly-grant',
    data: {},
    opts: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 } },
  },
);
// Search Console: daily sync of every connected property (after Google's 2–3 day lag).
await queues[QUEUES.content].upsertJobScheduler(
  'gsc.schedule',
  { pattern: '30 6 * * *', tz: 'UTC' },
  { name: 'gsc.schedule', data: {}, opts: { attempts: 2 } },
);
// Rank tracking: every hour, projects whose keywords are due get a daily check.
await queues[QUEUES.rankings].upsertJobScheduler(
  'rankings.schedule',
  { pattern: '10 * * * *', tz: 'UTC' },
  { name: 'rankings.schedule', data: {}, opts: { attempts: 2 } },
);

let running = true;
const health = startHealthServer(env.WORKER_HEALTH_PORT, deps, () => running);
logger.info({ queues: Object.values(QUEUES), port: env.WORKER_HEALTH_PORT }, 'worker started');

async function shutdown(signal: string) {
  if (!running) return;
  running = false;
  logger.info({ signal }, 'shutting down');
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled(Object.values(queues).map((q) => q.close()));
  await usage.flush();
  health.close();
  await Promise.allSettled([closeDb(), clickhouse.close()]);
  redis.disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
