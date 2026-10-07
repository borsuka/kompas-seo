import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { CREDIT_REASONS, JOB_STATUSES, JOB_TYPES, PLAN_IDS } from '@seo/shared';
import { organization, user } from './auth.js';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const orgId = () =>
  text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' });

export const deviceEnum = pgEnum('device', ['desktop', 'mobile']);
export const competitorSourceEnum = pgEnum('competitor_source', ['manual', 'auto']);
export const planEnum = pgEnum('plan', PLAN_IDS);
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'active',
  'trialing',
  'past_due',
  'canceled',
  'incomplete',
]);
export const creditReasonEnum = pgEnum('credit_reason', CREDIT_REASONS);
export const jobStatusEnum = pgEnum('job_status', JOB_STATUSES);
export const jobTypeEnum = pgEnum('job_type', JOB_TYPES);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    name: text('name').notNull(),
    /** Normalized host (lowercase, punycode, no www). */
    domain: text('domain').notNull(),
    locationCode: integer('location_code').notNull(),
    languageCode: text('language_code').notNull(),
    device: deviceEnum('device').notNull().default('desktop'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('projects_org_idx').on(t.organizationId),
    uniqueIndex('projects_org_domain_uidx')
      .on(t.organizationId, t.domain, t.locationCode, t.languageCode)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const projectCompetitors = pgTable(
  'project_competitors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Denormalized for org-scoped queries and isolation checks. */
    organizationId: orgId(),
    domain: text('domain').notNull(),
    source: competitorSourceEnum('source').notNull().default('manual'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('project_competitors_project_domain_uidx').on(t.projectId, t.domain),
    index('project_competitors_org_idx').on(t.organizationId),
  ],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    plan: planEnum('plan').notNull().default('free'),
    status: subscriptionStatusEnum('status').notNull().default('active'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true })
      .notNull()
      .defaultNow(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('subscriptions_org_uidx').on(t.organizationId)],
);

/** Append-only. The balance is the sum of `delta`; `org_credit_balances` caches it. */
export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    delta: integer('delta').notNull(),
    balanceAfter: bigint('balance_after', { mode: 'number' }).notNull(),
    reason: creditReasonEnum('reason').notNull(),
    description: text('description'),
    refType: text('ref_type'),
    refId: text('ref_id'),
    /** Makes grants/charges retry-safe: the same key is applied at most once per org. */
    idempotencyKey: text('idempotency_key'),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('credit_ledger_org_created_idx').on(t.organizationId, t.createdAt),
    uniqueIndex('credit_ledger_org_idem_uidx').on(t.organizationId, t.idempotencyKey),
  ],
);

export const orgCreditBalances = pgTable(
  'org_credit_balances',
  {
    organizationId: text('organization_id')
      .primaryKey()
      .references(() => organization.id, { onDelete: 'cascade' }),
    balance: bigint('balance', { mode: 'number' }).notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [check('org_credit_balances_non_negative', sql`${t.balance} >= 0`)],
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null for system jobs (e.g. monthly credit grant across all orgs). */
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    type: jobTypeEnum('type').notNull(),
    status: jobStatusEnum('status').notNull().default('queued'),
    progress: smallint('progress').notNull().default(0),
    message: text('message'),
    input: jsonb('input'),
    result: jsonb('result'),
    error: text('error'),
    createdAt: createdAt(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('jobs_org_created_idx').on(t.organizationId, t.createdAt)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    metadata: jsonb('metadata'),
    ipAddress: text('ip_address'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_org_created_idx').on(t.organizationId, t.createdAt)],
);
