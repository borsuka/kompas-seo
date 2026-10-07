import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  ClickHouseUsageSink,
  createProviders,
  RedisCacheStore,
  type ProviderSet,
  type UsageSink,
} from '@seo/data-providers';
import type { ClickHouseClient } from '@seo/db/clickhouse';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { CLICKHOUSE, PROVIDERS, REDIS, USAGE_SINK } from '../infra/tokens.js';
import { MeteredProviders } from './metered-providers.service.js';

@Global()
@Module({
  providers: [
    {
      provide: USAGE_SINK,
      inject: [CLICKHOUSE],
      useFactory: (ch: ClickHouseClient): UsageSink => {
        const logger = new Logger('ProviderUsage');
        return new ClickHouseUsageSink(ch, {
          onError: (err) => logger.error({ err }, 'Failed to write provider usage'),
        });
      },
    },
    {
      provide: PROVIDERS,
      inject: [API_ENV, REDIS, USAGE_SINK],
      useFactory: (env: ApiEnv, redis: Redis, usage: UsageSink): ProviderSet => {
        const logger = new Logger('Providers');
        return createProviders({
          env,
          cache: new RedisCacheStore(redis),
          usage,
          logger: { warn: (obj, msg) => logger.warn(obj, msg) },
        });
      },
    },
    MeteredProviders,
  ],
  exports: [PROVIDERS, USAGE_SINK, MeteredProviders],
})
export class ProvidersModule implements OnApplicationShutdown {
  constructor(@Inject(USAGE_SINK) private readonly usage: UsageSink) {}

  async onApplicationShutdown() {
    await this.usage.flush();
  }
}
