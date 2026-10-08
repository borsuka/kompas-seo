import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { RANK_ALERT_TYPES } from '@seo/shared';
import { organization, user } from './auth.js';
import { deviceEnum, projects } from './app.js';

const orgId = () =>
  text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' });
const projectId = () =>
  uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' });

/**
 * Keywords whose position is checked daily for a project. Position history itself
 * lives in ClickHouse (`rank_history`, `rank_competitor_history`).
 */
export const trackedKeywords = pgTable(
  'tracked_keywords',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    projectId: projectId(),
    keyword: text('keyword').notNull(),
    locationCode: integer('location_code').notNull(),
    languageCode: text('language_code').notNull(),
    device: deviceEnum('device').notNull(),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tracked_keywords_uidx').on(
      t.projectId,
      t.keyword,
      t.locationCode,
      t.languageCode,
      t.device,
    ),
    index('tracked_keywords_org_idx').on(t.organizationId),
    index('tracked_keywords_due_idx').on(t.lastCheckedAt),
  ],
);

export const rankAlertTypeEnum = pgEnum('rank_alert_type', RANK_ALERT_TYPES);

export const rankAlerts = pgTable(
  'rank_alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    projectId: projectId(),
    type: rankAlertTypeEnum('type').notNull(),
    threshold: smallint('threshold').notNull(),
    /** Only keywords with this tag; null = every tracked keyword. */
    tag: text('tag'),
    emails: text('emails').array().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('rank_alerts_project_idx').on(t.projectId)],
);

/** One row per triggered alert, keyword and check date (dedupes repeated checks). */
export const rankAlertEvents = pgTable(
  'rank_alert_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    projectId: projectId(),
    alertId: uuid('alert_id')
      .notNull()
      .references(() => rankAlerts.id, { onDelete: 'cascade' }),
    trackedKeywordId: uuid('tracked_keyword_id')
      .notNull()
      .references(() => trackedKeywords.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    previousPosition: smallint('previous_position'),
    position: smallint('position'),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('rank_alert_events_uidx').on(t.alertId, t.trackedKeywordId, t.date),
    index('rank_alert_events_project_idx').on(t.projectId, t.createdAt),
  ],
);
