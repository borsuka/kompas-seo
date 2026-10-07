import { eq } from 'drizzle-orm';
import { DEFAULT_PLAN, PLANS, type PlanId } from '@seo/shared';
import type { Database, DbExecutor } from '../client.js';
import { subscriptions } from '../schema/app.js';
import { applyCreditEntry, getCreditBalance, planGrantKey } from './credits.js';

export async function getOrganizationPlan(db: DbExecutor, organizationId: string): Promise<PlanId> {
  const [row] = await db
    .select({ plan: subscriptions.plan })
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId));
  return row?.plan ?? DEFAULT_PLAN;
}

/**
 * Runs once for every new organization: creates its (free) subscription and grants
 * this month's plan credits. Idempotent, so it is safe to call again.
 */
export async function bootstrapOrganization(
  db: Database,
  organizationId: string,
  now = new Date(),
) {
  await db
    .insert(subscriptions)
    .values({ organizationId, plan: DEFAULT_PLAN, status: 'active', currentPeriodStart: now })
    .onConflictDoNothing();
  const plan = await getOrganizationPlan(db, organizationId);
  await grantMonthlyCredits(db, organizationId, plan, now);
}

/**
 * Grants the plan's monthly credits for the month of `now`. Unused credits from
 * previous months expire: the grant tops the balance up to the plan amount.
 */
export async function grantMonthlyCredits(
  db: Database,
  organizationId: string,
  plan: PlanId,
  now = new Date(),
) {
  const target = PLANS[plan].monthlyCredits;
  const balance = await getCreditBalance(db, organizationId);
  const delta = Math.max(0, target - balance);
  return applyCreditEntry(db, {
    organizationId,
    delta,
    reason: 'plan_grant',
    description: `${plan} plan · ${now.toISOString().slice(0, 7)}`,
    idempotencyKey: planGrantKey(now),
  });
}
