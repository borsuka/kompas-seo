import { z } from 'zod';
import { planIdSchema } from '../plans.js';

export const PAID_PLANS = ['pro', 'agency'] as const;
export const checkoutSchema = z.object({ plan: z.enum(PAID_PLANS) });

export const billingOverviewSchema = z.object({
  /** BILLING_ENABLED and Stripe configured. */
  enabled: z.boolean(),
  plan: planIdSchema,
  status: z.string(),
  currentPeriodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  /** A Stripe customer exists (the billing portal can be opened). */
  hasCustomer: z.boolean(),
  plans: z.array(
    z.object({
      id: planIdSchema,
      monthlyCredits: z.number().int(),
      maxProjects: z.number().int(),
      maxMembers: z.number().int(),
      maxTrackedKeywords: z.number().int(),
      apiAccess: z.boolean(),
      /** Can be bought through Checkout. */
      purchasable: z.boolean(),
    }),
  ),
});
export type BillingOverview = z.infer<typeof billingOverviewSchema>;
