/**
 * Integration test helpers: a private Postgres + ClickHouse database per test file (API
 * tests truncate seo_test in parallel) and a JobContext with in-memory side effects.
 */
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { Crawler, MemoryRobotsCache } from '@seo/crawler';
import { GoogleGscClient, MockGscClient, MockProvider } from '@seo/data-providers';
import { createDb, runMigrations, sql, type Database } from '@seo/db';
import {
  clickHouseConfigFromEnv,
  createClickHouse,
  type ClickHouseClient,
} from '@seo/db/clickhouse';
import { DisabledLLMProvider } from '@seo/llm';
import { DEFAULT_CREDIT_COSTS } from '@seo/shared';
import { clickhouseEnvSchema, loadRootEnv, parseEnv } from '@seo/shared/server';
import type { EmailContent } from './mailer.js';
import type { JobContext, WorkerDeps } from './runtime.js';

export async function setupTestDatabases(name: string) {
  loadRootEnv();
  const testUrl = new URL(
    process.env.TEST_DATABASE_URL ?? 'postgres://seo:seo@localhost:15432/seo_test',
  );
  const url = Object.assign(new URL(testUrl), { pathname: `/${name}` }).toString();
  const chConfig = clickHouseConfigFromEnv(
    parseEnv(clickhouseEnvSchema, { ...process.env, CLICKHOUSE_DATABASE: name }),
  );
  const admin = createDb(Object.assign(new URL(testUrl), { pathname: '/postgres' }).toString(), {
    max: 1,
  });
  const exists = await admin.db.execute(sql`select 1 from pg_database where datname = ${name}`);
  if (!exists.rows.length) await admin.db.execute(sql.raw(`create database ${name}`));
  await admin.close();
  await runMigrations({ databaseUrl: url, clickhouse: chConfig, log: () => undefined });
  const { db, close } = createDb(url, { max: 4 });
  const ch = createClickHouse(chConfig);
  return {
    db,
    ch,
    close: async () => {
      await close();
      await ch.close();
    },
  };
}

export interface TestEffects {
  sent: { to: string | string[]; content: EmailContent }[];
  enqueued: { type: string; input: unknown; dedupeKey?: string }[];
}

export function makeContext(
  env: { db: Database; ch: ClickHouseClient },
  orgId: string | null,
  overrides: Partial<WorkerDeps> = {},
): { ctx: JobContext; effects: TestEffects } {
  const effects: TestEffects = { sent: [], enqueued: [] };
  const logger = { child: () => logger, info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const store = new Map<string, string>();
  const deps: WorkerDeps = {
    db: env.db,
    clickhouse: env.ch,
    // Minimal in-memory Redis for token caches.
    redis: {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => void store.set(k, v),
    } as never,
    providers: { serp: new MockProvider() } as never,
    logger: logger as never,
    mailer: { send: async (to, content) => void effects.sent.push({ to, content }) },
    appUrl: 'http://localhost:3000',
    creditCosts: DEFAULT_CREDIT_COSTS,
    enqueue: async (type, input, opts) => {
      effects.enqueued.push({ type, input, dedupeKey: opts.dedupeKey });
      return randomUUID();
    },
    llm: new DisabledLLMProvider(),
    crawler: new Crawler(new MemoryRobotsCache()),
    gsc: { google: new GoogleGscClient(), mock: new MockGscClient(), oauth: null },
    encryptionKey: Buffer.alloc(32, 7).toString('base64'),
    ...overrides,
  };
  return {
    ctx: {
      deps,
      logger: logger as never,
      progress: async () => undefined,
      attempt: 1,
      isFinalAttempt: true,
      orgId,
    },
    effects,
  };
}
