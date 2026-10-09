import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.service.js';
import { AuthModule } from './auth/auth.module.js';
import { PermissionGuard, SessionGuard } from './auth/guards.js';
import { AppErrorFilter } from './common/error.filter.js';
import { RedisThrottlerStorage } from './common/throttler-redis.storage.js';
import { API_ENV, loadApiEnv, type ApiEnv } from './config/env.js';
import { CreditsModule } from './credits/credits.module.js';
import { DomainsModule } from './domains/domains.module.js';
import { RankingsModule } from './rankings/rankings.module.js';
import { BacklinksModule } from './backlinks/backlinks.module.js';
import { ContentModule } from './content/content.module.js';
import { GscModule } from './gsc/gsc.module.js';
import { HealthModule } from './health/health.controller.js';
import { InfraModule } from './infra/infra.module.js';
import { REDIS } from './infra/tokens.js';
import { JobsModule } from './jobs/jobs.module.js';
import { KeywordListsModule } from './keyword-lists/keyword-lists.module.js';
import { KeywordsModule } from './keywords/keywords.module.js';
import { LlmModule } from './llm/llm.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { ProvidersModule } from './providers/providers.module.js';

const env = loadApiEnv();

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
        genReqId: (req, res) => {
          const incoming = req.headers['x-request-id'];
          const id =
            typeof incoming === 'string' && incoming.length <= 64 ? incoming : randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
        autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
        transport:
          env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } }
            : undefined,
      },
    }),
    InfraModule,
    ThrottlerModule.forRootAsync({
      inject: [API_ENV, REDIS],
      useFactory: (e: ApiEnv, redis: Redis) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: e.RATE_LIMIT_PER_MINUTE }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    AuthModule,
    AuditModule,
    CreditsModule,
    ProvidersModule,
    HealthModule,
    OrganizationsModule,
    ProjectsModule,
    JobsModule,
    LlmModule,
    KeywordsModule,
    KeywordListsModule,
    DomainsModule,
    RankingsModule,
    BacklinksModule,
    ContentModule,
    GscModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AppErrorFilter },
    // Order matters: rate limit → session → organization permission.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
