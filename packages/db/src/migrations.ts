import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';
import { migrateClickHouse } from './clickhouse/migrate.js';
import type { ClickHouseConfig } from './clickhouse/client.js';

/** Absolute paths to the committed migration folders (resolved from dist/ or src/). */
export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
export const clickhouseMigrationsFolder = fileURLToPath(
  new URL('../clickhouse/migrations', import.meta.url),
);

export async function runMigrations(opts: {
  databaseUrl: string;
  clickhouse: ClickHouseConfig;
  log?: (msg: string) => void;
}): Promise<void> {
  const log = opts.log ?? console.warn;
  const { db, close } = createDb(opts.databaseUrl, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
    log('postgres: migrations up to date');
  } finally {
    await close();
  }
  await migrateClickHouse(opts.clickhouse, clickhouseMigrationsFolder, log);
  log('clickhouse: migrations up to date');
}
