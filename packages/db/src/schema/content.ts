import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { BRIEF_STATUSES } from '@seo/shared';
import { organization, user } from './auth.js';
import { projects } from './app.js';

const orgId = () =>
  text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const briefStatusEnum = pgEnum('brief_status', BRIEF_STATUSES);

/** Content briefs: top-10 analysis + outline for one keyword and market. */
export const contentBriefs = pgTable(
  'content_briefs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    keyword: text('keyword').notNull(),
    locationCode: integer('location_code').notNull(),
    languageCode: text('language_code').notNull(),
    status: briefStatusEnum('status').notNull().default('queued'),
    /** `ai` | `template` once ready. */
    source: text('source'),
    jobId: uuid('job_id'),
    analysis: jsonb('analysis'),
    pages: jsonb('pages')
      .notNull()
      .default(sql`'[]'::jsonb`),
    peopleAlsoAsk: jsonb('people_also_ask')
      .notNull()
      .default(sql`'[]'::jsonb`),
    brief: jsonb('brief'),
    error: text('error'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('content_briefs_org_idx').on(t.organizationId, t.createdAt)],
);

export const gscStatusEnum = pgEnum('gsc_status', ['pending_site', 'active', 'error']);

/** Google Search Console connection of a project (one property per project). */
export const gscConnections = pgTable(
  'gsc_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** `google` or `mock` (local development without a Google account). */
    provider: text('provider').notNull(),
    status: gscStatusEnum('status').notNull(),
    /** Search Console property, e.g. `sc-domain:example.bg` or `https://www.example.bg/`. */
    siteUrl: text('site_url'),
    /** OAuth refresh token, AES-256-GCM encrypted (`encryptSecret`). */
    refreshTokenEnc: text('refresh_token_enc'),
    scope: text('scope'),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastError: text('last_error'),
    connectedBy: text('connected_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('gsc_connections_project_uidx').on(t.projectId),
    index('gsc_connections_org_idx').on(t.organizationId),
  ],
);
