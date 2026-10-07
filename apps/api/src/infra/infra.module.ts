import { Global, Inject, Module, type OnApplicationShutdown, type Provider } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createDb, type DbHandle } from '@seo/db';
import {
  clickHouseConfigFromEnv,
  createClickHouse,
  type ClickHouseClient,
} from '@seo/db/clickhouse';
import { QUEUES as QUEUE_NAMES, type QueueName } from '@seo/shared';
import { API_ENV, loadApiEnv, type ApiEnv } from '../config/env.js';
import { CLICKHOUSE, DB, DB_HANDLE, QUEUES, REDIS } from './tokens.js';

export type QueueMap = Record<QueueName, Queue>;

const providers: Provider[] = [
  { provide: API_ENV, useFactory: () => loadApiEnv() },
  {
    provide: DB_HANDLE,
    inject: [API_ENV],
    useFactory: (env: ApiEnv): DbHandle => createDb(env.DATABASE_URL, { max: 20 }),
  },
  { provide: DB, inject: [DB_HANDLE], useFactory: (h: DbHandle) => h.db },
  {
    provide: CLICKHOUSE,
    inject: [API_ENV],
    useFactory: (env: ApiEnv) => createClickHouse(clickHouseConfigFromEnv(env)),
  },
  {
    provide: REDIS,
    inject: [API_ENV],
    // `maxRetriesPerRequest: null` is required by BullMQ for shared connections.
    useFactory: (env: ApiEnv) =>
      new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false }),
  },
  {
    provide: QUEUES,
    inject: [REDIS],
    useFactory: (redis: Redis): QueueMap =>
      Object.fromEntries(
        Object.values(QUEUE_NAMES).map((name) => [name, new Queue(name, { connection: redis })]),
      ) as QueueMap,
  },
];

/** Postgres, ClickHouse, Redis and BullMQ producers, shared app-wide. */
@Global()
@Module({ providers, exports: providers.map((p) => (p as { provide: symbol }).provide) })
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB_HANDLE) private readonly dbHandle: DbHandle,
    @Inject(CLICKHOUSE) private readonly clickhouse: ClickHouseClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(QUEUES) private readonly queues: QueueMap,
  ) {}

  async onApplicationShutdown() {
    await Promise.allSettled(Object.values(this.queues).map((q) => q.close()));
    await Promise.allSettled([this.dbHandle.close(), this.clickhouse.close()]);
    this.redis.disconnect();
  }
}
