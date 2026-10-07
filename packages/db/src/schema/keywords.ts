import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { organization, user } from './auth.js';
import { projects } from './app.js';

/**
 * Keyword lists live in Postgres (small, user-edited, org-scoped). Keyword metrics
 * themselves are in ClickHouse `keywords` and joined at read time.
 */
export const keywordLists = pgTable(
  'keyword_lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    locationCode: integer('location_code').notNull(),
    languageCode: text('language_code').notNull(),
    clusteredAt: timestamp('clustered_at', { withTimezone: true }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('keyword_lists_org_idx').on(t.organizationId, t.createdAt)],
);

export const keywordListItems = pgTable(
  'keyword_list_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listId: uuid('list_id')
      .notNull()
      .references(() => keywordLists.id, { onDelete: 'cascade' }),
    /** Denormalized for org-scoped queries. */
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    keyword: text('keyword').notNull(),
    note: text('note'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    cluster: text('cluster'),
    addedBy: text('added_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('keyword_list_items_list_keyword_uidx').on(t.listId, t.keyword),
    index('keyword_list_items_org_idx').on(t.organizationId),
  ],
);
