import { describe, expect, it } from 'vitest';
import { clickhouseMigrationsFolder } from '../migrations.js';
import { loadClickHouseMigrations, splitStatements } from './migrate.js';

describe('splitStatements', () => {
  it('splits on trailing semicolons and drops comment lines', () => {
    const sql = `-- header comment
CREATE TABLE a (x UInt8) ENGINE = Memory;

-- another
CREATE TABLE b (s String DEFAULT 'a;b') ENGINE = Memory;
`;
    expect(splitStatements(sql)).toEqual([
      'CREATE TABLE a (x UInt8) ENGINE = Memory',
      "CREATE TABLE b (s String DEFAULT 'a;b') ENGINE = Memory",
    ]);
  });
});

describe('committed ClickHouse migrations', () => {
  const migrations = loadClickHouseMigrations(clickhouseMigrationsFolder);

  it('are ordered with unique versions and checksums', () => {
    expect(migrations.length).toBeGreaterThan(0);
    const versions = migrations.map((m) => m.version);
    expect([...versions].sort()).toEqual(versions);
    expect(new Set(versions).size).toBe(versions.length);
    for (const m of migrations) expect(m.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('create every table from the data model', () => {
    const all = migrations.map((m) => m.sql).join('\n');
    for (const table of [
      'keywords',
      'serp_snapshots',
      'rank_history',
      'domain_keywords',
      'backlinks',
      'domain_metrics',
      'provider_usage',
    ]) {
      expect(all).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });
});
