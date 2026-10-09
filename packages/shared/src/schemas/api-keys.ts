import { z } from 'zod';

/** Prefix of every public API key (`ks_` + 43 base64url characters). */
export const API_KEY_PREFIX = 'ks_';

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** Keys act for their creator with at most this role. */
  role: z.enum(['member', 'viewer']).default('viewer'),
});
export type CreateApiKeyInput = z.input<typeof createApiKeySchema>;

export const apiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  role: z.enum(['member', 'viewer']),
  createdBy: z.object({ id: z.string(), name: z.string() }),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type ApiKey = z.infer<typeof apiKeySchema>;

/** Returned once on creation: the only time the secret is visible. */
export const createdApiKeySchema = apiKeySchema.extend({ key: z.string() });
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;
