import { loadRootEnv } from '@seo/shared/server';

/** Points every connection at the isolated test databases. */
export function applyTestEnv() {
  loadRootEnv();
  const env = process.env;
  env.NODE_ENV = 'test';
  env.DATABASE_URL = env.TEST_DATABASE_URL ?? 'postgres://seo:seo@localhost:5432/seo_test';
  env.CLICKHOUSE_DATABASE = env.CLICKHOUSE_TEST_DATABASE ?? 'seo_test';
  // Redis logical DB 15 is reserved for tests.
  const redis = new URL(env.REDIS_URL ?? 'redis://localhost:6379');
  redis.pathname = '/15';
  env.REDIS_URL = redis.toString();
  env.AUTH_REQUIRE_EMAIL_VERIFICATION = 'false';
  env.RATE_LIMIT_PER_MINUTE = '100000';
  env.KEYWORD_PROVIDER = 'mock';
  env.SERP_PROVIDER = 'mock';
  env.DOMAIN_PROVIDER = 'mock';
  env.BACKLINK_PROVIDER = 'mock';
  env.SENTRY_DSN = '';
  env.GOOGLE_CLIENT_ID = '';
  env.GOOGLE_CLIENT_SECRET = '';
}
