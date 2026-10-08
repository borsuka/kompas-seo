import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vite's oxc transform honours tsconfig `emitDecoratorMetadata`, which Nest DI needs.
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup-env.ts'],
    // Integration tests share one test database: run files sequentially.
    fileParallelism: false,
    testTimeout: 30_000,
    // Generous: app bootstrap can be slow while other workspaces build in parallel.
    hookTimeout: 120_000,
  },
});
