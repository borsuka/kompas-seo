import { Controller, Get, HttpCode, Inject, Module, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { sql, type Database } from '@seo/db';
import type { ClickHouseClient } from '@seo/db/clickhouse';
import { Public } from '../common/request-context.js';
import { CLICKHOUSE, DB, REDIS } from '../infra/tokens.js';

type CheckResult = { status: 'ok' } | { status: 'error'; error: string };

async function check(fn: () => Promise<unknown>, timeoutMs = 2000): Promise<CheckResult> {
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs).unref()),
    ]);
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

@ApiTags('health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLICKHOUSE) private readonly clickhouse: ClickHouseClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Liveness: the process is up. */
  @Get('live')
  @HttpCode(200)
  live() {
    return { status: 'ok' };
  }

  /** Readiness: all dependencies respond. 503 when any of them fails. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const [postgres, clickhouse, redis] = await Promise.all([
      check(() => this.db.execute(sql`select 1`)),
      check(async () => {
        const r = await this.clickhouse.ping();
        if (!r.success) throw r.error;
      }),
      check(() => this.redis.ping()),
    ]);
    const checks = { postgres, clickhouse, redis };
    const ok = Object.values(checks).every((c) => c.status === 'ok');
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'error', checks };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
