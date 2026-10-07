import { apiEnvSchema, loadRootEnv, parseEnv, type ApiEnv } from '@seo/shared/server';

export const API_ENV = Symbol('API_ENV');
export type { ApiEnv };

let cached: ApiEnv | null = null;

/** Parses and caches the API environment (fail fast at startup). */
export function loadApiEnv(overrides: Partial<Record<keyof ApiEnv, string>> = {}): ApiEnv {
  if (cached && Object.keys(overrides).length === 0) return cached;
  loadRootEnv();
  const env = parseEnv(apiEnvSchema, { ...process.env, ...overrides });
  if (Object.keys(overrides).length === 0) cached = env;
  return env;
}
