import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { encryptionEnvSchema, parseEnv, providerEnvSchema } from './env.js';

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv(providerEnvSchema, {});
    expect(env.KEYWORD_PROVIDER).toBe('mock');
    expect(env.DATAFORSEO_SANDBOX).toBe(false);
    expect(env.DATAFORSEO_LOGIN).toBeUndefined();
  });

  it('reports every invalid variable', () => {
    const schema = z.object({ A: z.string().url(), B: z.coerce.number().int() });
    expect(() => parseEnv(schema, { A: 'nope', B: 'x' })).toThrow(/A:[\s\S]*B:/);
  });

  it('refuses the example secrets from .env.example in production only', () => {
    const schema = encryptionEnvSchema.extend({ NODE_ENV: z.string() });
    const ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
    expect(parseEnv(schema, { NODE_ENV: 'development', ENCRYPTION_KEY }).ENCRYPTION_KEY).toBe(
      ENCRYPTION_KEY,
    );
    expect(() => parseEnv(schema, { NODE_ENV: 'production', ENCRYPTION_KEY })).toThrow(
      /ENCRYPTION_KEY: the example value/,
    );
    const own = Buffer.alloc(32, 7).toString('base64');
    expect(parseEnv(schema, { NODE_ENV: 'production', ENCRYPTION_KEY: own }).ENCRYPTION_KEY).toBe(
      own,
    );
  });
});
