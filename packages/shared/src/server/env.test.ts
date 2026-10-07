import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseEnv, providerEnvSchema } from './env.js';

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
});
