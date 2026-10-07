import { runMigrations } from '@seo/db';
import { clickHouseConfigFromEnv } from '@seo/db/clickhouse';
import { clickhouseEnvSchema, parseEnv } from '@seo/shared/server';
import { applyTestEnv } from './test-env.js';

/** Migrates the test databases once before the whole suite. */
export default async function setup() {
  applyTestEnv();
  await runMigrations({
    databaseUrl: process.env.DATABASE_URL!,
    clickhouse: clickHouseConfigFromEnv(parseEnv(clickhouseEnvSchema)),
    log: () => undefined,
  });
}
