import { defineConfig } from 'drizzle-kit';

try {
  process.loadEnvFile('../../.env');
} catch {
  // .env is optional (CI passes env vars directly).
}

export default defineConfig({
  dialect: 'postgresql',
  // Compiled output: drizzle-kit cannot resolve `.js` specifiers in TS sources.
  schema: './dist/schema/index.js',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://seo:seo@localhost:5432/seo' },
  strict: true,
  verbose: true,
});
