import { grantMonthlyCredits, schema } from '@seo/db';
import type { Processor } from '../runtime.js';

/**
 * Monthly credit grant for every organization according to its plan (except Stripe
 * subscriptions, which are topped up on each paid invoice).
 * Idempotent per org and month (ledger idempotency key), so re-runs are safe.
 */
export const monthlyGrant: Processor<unknown, { organizations: number; granted: number }> = async (
  _input,
  ctx,
) => {
  const subs = await ctx.deps.db
    .select({
      organizationId: schema.subscriptions.organizationId,
      plan: schema.subscriptions.plan,
      stripeSubscriptionId: schema.subscriptions.stripeSubscriptionId,
    })
    .from(schema.subscriptions);
  let granted = 0;
  for (const [i, sub] of subs.entries()) {
    // Stripe subscriptions get their credits on every paid invoice (billing webhook).
    if (sub.stripeSubscriptionId) continue;
    const res = await grantMonthlyCredits(ctx.deps.db, sub.organizationId, sub.plan);
    if (res.applied) granted++;
    if (i % 50 === 0) await ctx.progress((i / subs.length) * 100);
  }
  ctx.logger.info({ organizations: subs.length, granted }, 'monthly credits granted');
  return { organizations: subs.length, granted };
};
