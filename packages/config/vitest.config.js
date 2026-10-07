import { defineConfig } from 'vitest/config';

/** Shared Vitest defaults for library packages. */
export const baseVitestConfig = defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
  },
});

export default baseVitestConfig;
