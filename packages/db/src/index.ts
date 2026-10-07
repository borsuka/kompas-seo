export * from './client.js';
export * as schema from './schema/index.js';
export * from './schema/index.js';
export { migrationsFolder, clickhouseMigrationsFolder, runMigrations } from './migrations.js';
// Re-export query helpers so consumers share this package's drizzle-orm instance.
export {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  isNotNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type InferInsertModel,
  type InferSelectModel,
  type SQL,
} from 'drizzle-orm';
