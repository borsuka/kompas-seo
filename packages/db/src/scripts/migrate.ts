/**
 * Applies Postgres (drizzle) and ClickHouse migrations.
 * Usage: `pnpm db:migrate` (dev databases) or `pnpm db:migrate --test` (test databases).
 */
import { clickhouseEnvSchema, databaseEnvSchema, loadRootEnv, parseEnv } from '@seo/shared/server';
import { clickHouseConfigFromEnv } from '../clickhouse/client.js';
import { runMigrations } from '../migrations.js';

loadRootEnv();
const isTest = process.argv.includes('--test');
const env = parseEnv(databaseEnvSchema.extend(clickhouseEnvSchema.shape), {
  ...process.env,
  ...(isTest && {
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    CLICKHOUSE_DATABASE: process.env.CLICKHOUSE_TEST_DATABASE ?? 'seo_test',
  }),
});

await runMigrations({
  databaseUrl: env.DATABASE_URL,
  clickhouse: clickHouseConfigFromEnv(env),
});
