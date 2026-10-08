import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { organization, user } from './auth.js';
import { projects } from './app.js';

export const disavowTypeEnum = pgEnum('disavow_type', ['domain', 'url']);

/** Domains/URLs a project wants Google to ignore; exported as a disavow file. */
export const disavowEntries = pgTable(
  'disavow_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: disavowTypeEnum('type').notNull(),
    /** Normalized domain (no www) or absolute URL. */
    value: text('value').notNull(),
    reason: text('reason'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('disavow_entries_uidx').on(t.projectId, t.type, t.value),
    index('disavow_entries_org_idx').on(t.organizationId),
  ],
);
