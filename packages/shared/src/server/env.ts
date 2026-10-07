import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';

/**
 * Loads the monorepo root `.env` (walking up from cwd) into `process.env`.
 * Existing environment variables win, so CI/production values are never overridden.
 */
export function loadRootEnv(startDir = process.cwd()): string | null {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate) && existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      process.loadEnvFile(candidate);
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : undefined));

export const commonEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SENTRY_DSN: optionalString,
});

export const databaseEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
});

export const clickhouseEnvSchema = z.object({
  CLICKHOUSE_URL: z.string().url(),
  CLICKHOUSE_USER: z.string().default('default'),
  CLICKHOUSE_PASSWORD: z.string().default(''),
  CLICKHOUSE_DATABASE: z
    .string()
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
    .default('seo'),
});

export const redisEnvSchema = z.object({
  REDIS_URL: z.string().url(),
});

export const providerEnvSchema = z.object({
  KEYWORD_PROVIDER: z.enum(['mock', 'dataforseo']).default('mock'),
  SERP_PROVIDER: z.enum(['mock', 'dataforseo']).default('mock'),
  DOMAIN_PROVIDER: z.enum(['mock', 'dataforseo']).default('mock'),
  BACKLINK_PROVIDER: z.enum(['mock', 'dataforseo']).default('mock'),
  DATAFORSEO_LOGIN: optionalString,
  DATAFORSEO_PASSWORD: optionalString,
  DATAFORSEO_SANDBOX: bool,
  CREDIT_COSTS_JSON: optionalString,
});

export const emailEnvSchema = z.object({
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(11025),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  SMTP_SECURE: bool,
  EMAIL_FROM: z.string().default('Kompas SEO <no-reply@kompas.local>'),
});

export const encryptionEnvSchema = z.object({
  ENCRYPTION_KEY: z
    .string()
    .refine(
      (k) => Buffer.from(k, 'base64').length === 32,
      'ENCRYPTION_KEY must be 32 bytes, base64',
    ),
});

export const apiEnvSchema = commonEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(clickhouseEnvSchema.shape)
  .extend(redisEnvSchema.shape)
  .extend(providerEnvSchema.shape)
  .extend(emailEnvSchema.shape)
  .extend(encryptionEnvSchema.shape)
  .extend({
    API_PORT: z.coerce.number().int().default(4000),
    APP_URL: z.string().url().default('http://localhost:3000'),
    BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
    AUTH_REQUIRE_EMAIL_VERIFICATION: bool,
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    BILLING_ENABLED: bool,
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
    ANTHROPIC_API_KEY: optionalString,
    ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  });
export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const workerEnvSchema = commonEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(clickhouseEnvSchema.shape)
  .extend(redisEnvSchema.shape)
  .extend(providerEnvSchema.shape)
  .extend(emailEnvSchema.shape)
  .extend({
    WORKER_HEALTH_PORT: z.coerce.number().int().default(4001),
    APP_URL: z.string().url().default('http://localhost:3000'),
  });
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/** Parses env with a readable, aggregated error message (fail fast at startup). */
export function parseEnv<T extends z.ZodType>(
  schema: T,
  env: NodeJS.ProcessEnv = process.env,
): z.infer<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
