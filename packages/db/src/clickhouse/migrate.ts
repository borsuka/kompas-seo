import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClickHouse, type ClickHouseConfig } from './client.js';

export interface ClickHouseMigration {
  version: string;
  sql: string;
  checksum: string;
}

const FILE_RE = /^(\d{4})_[a-z0-9_]+\.sql$/;

export function loadClickHouseMigrations(dir: string): ClickHouseMigration[] {
  return readdirSync(dir)
    .filter((f) => FILE_RE.test(f))
    .sort()
    .map((file) => {
      const sql = readFileSync(join(dir, file), 'utf8');
      return {
        version: file.replace(/\.sql$/, ''),
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    });
}

/** Splits a migration file into statements (a statement ends with `;` at end of line). */
export function splitStatements(sql: string): string[] {
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return withoutComments
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Applies pending migrations in order. Already-applied migrations are verified by
 * checksum so edited history is detected instead of silently diverging.
 */
export async function migrateClickHouse(
  config: ClickHouseConfig,
  migrationsDir: string,
  log: (msg: string) => void = console.warn,
): Promise<string[]> {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(config.database)) {
    throw new Error(`Invalid ClickHouse database name: ${config.database}`);
  }
  const admin = createClickHouse({ ...config, database: 'default' });
  try {
    await admin.command({ query: `CREATE DATABASE IF NOT EXISTS ${config.database}` });
  } finally {
    await admin.close();
  }

  const ch = createClickHouse(config);
  try {
    await ch.command({
      query: `CREATE TABLE IF NOT EXISTS schema_migrations
        (version String, checksum String, applied_at DateTime64(3, 'UTC') DEFAULT now64(3))
        ENGINE = MergeTree ORDER BY version`,
    });
    const rows = await ch
      .query({ query: 'SELECT version, checksum FROM schema_migrations', format: 'JSONEachRow' })
      .then((r) => r.json<{ version: string; checksum: string }>());
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));

    const done: string[] = [];
    for (const m of loadClickHouseMigrations(migrationsDir)) {
      const existing = applied.get(m.version);
      if (existing) {
        if (existing !== m.checksum) {
          throw new Error(
            `ClickHouse migration ${m.version} was modified after being applied. Add a new migration instead.`,
          );
        }
        continue;
      }
      for (const statement of splitStatements(m.sql)) {
        await ch.command({ query: statement });
      }
      await ch.insert({
        table: 'schema_migrations',
        values: [{ version: m.version, checksum: m.checksum }],
        format: 'JSONEachRow',
      });
      log(`clickhouse: applied ${m.version}`);
      done.push(m.version);
    }
    return done;
  } finally {
    await ch.close();
  }
}
