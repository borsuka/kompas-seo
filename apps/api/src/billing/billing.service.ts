import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import Stripe from 'stripe';
import { eq, getOrganizationPlan, grantMonthlyCredits, schema, type Database } from '@seo/db';
import { AppError, PLAN_IDS, PLANS, type BillingOverview, type PlanId } from '@seo/shared';
import { AuditService } from '../audit/audit.service.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { DB, REDIS } from '../infra/tokens.js';

type Status = (typeof schema.subscriptions.$inferSelect)['status'];

/** Stripe subscription status → our status (we keep fewer states). */
function mapStatus(s: Stripe.Subscription.Status): Status {
  switch (s) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    case 'incomplete':
      return 'incomplete';
    default:
      // past_due, unpaid, paused
      return 'past_due';
  }
}

const EVENT_TTL_SEC = 7 * 86_400;

/**
 * Stripe Billing behind BILLING_ENABLED: Checkout for the paid plans, the customer portal
 * for changes and cancellation, and webhooks as the only source of truth for plan state.
 * Paid plans get their credits on every paid invoice (the monthly job skips them).
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger('Billing');
  private readonly stripe: Stripe | null;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly audit: AuditService,
  ) {
    this.stripe =
      env.BILLING_ENABLED && env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;
    if (env.BILLING_ENABLED && (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET))
      throw new Error('BILLING_ENABLED=true requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET');
  }

  private get prices(): Partial<Record<PlanId, string>> {
    return { pro: this.env.STRIPE_PRICE_PRO, agency: this.env.STRIPE_PRICE_AGENCY };
  }

  private planOfPrice(priceId: string | undefined): PlanId | null {
    const entry = Object.entries(this.prices).find(([, id]) => id && id === priceId);
    return (entry?.[0] as PlanId | undefined) ?? null;
  }

  private requireStripe(): Stripe {
    if (!this.stripe) throw new AppError('PROVIDER_NOT_CONFIGURED', 'Billing is not enabled');
    return this.stripe;
  }

  private async subscription(organizationId: string) {
    const [row] = await this.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.organizationId, organizationId));
    return row ?? null;
  }

  async overview(organizationId: string): Promise<BillingOverview> {
    const sub = await this.subscription(organizationId);
    const plan = await getOrganizationPlan(this.db, organizationId);
    return {
      enabled: !!this.stripe,
      plan,
      status: sub?.status ?? 'active',
      currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      hasCustomer: !!sub?.stripeCustomerId,
      plans: PLAN_IDS.map((id) => ({
        id,
        monthlyCredits: PLANS[id].monthlyCredits,
        maxProjects: PLANS[id].maxProjects,
        maxMembers: PLANS[id].maxMembers,
        maxTrackedKeywords: PLANS[id].maxTrackedKeywords,
        apiAccess: PLANS[id].apiAccess,
        purchasable: !!this.stripe && !!this.prices[id],
      })),
    };
  }

  /** Hosted Checkout for a paid plan. An existing subscription is changed in the portal. */
  async checkout(
    actor: { organizationId: string; email: string; locale: string },
    plan: 'pro' | 'agency',
  ): Promise<{ url: string }> {
    const stripe = this.requireStripe();
    const price = this.prices[plan];
    if (!price)
      throw new AppError('PROVIDER_NOT_CONFIGURED', `No Stripe price for the ${plan} plan`);
    const sub = await this.subscription(actor.organizationId);
    if (sub?.stripeSubscriptionId && sub.status !== 'canceled')
      throw new AppError('CONFLICT', 'Change the existing subscription in the billing portal');
    const back = `${this.env.APP_URL}/app/settings?tab=billing`;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      ...(sub?.stripeCustomerId
        ? { customer: sub.stripeCustomerId }
        : { customer_email: actor.email }),
      client_reference_id: actor.organizationId,
      metadata: { organizationId: actor.organizationId, plan },
      subscription_data: { metadata: { organizationId: actor.organizationId, plan } },
      allow_promotion_codes: true,
      locale: actor.locale === 'bg' ? 'bg' : 'en',
      success_url: `${back}&checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${back}&checkout=cancelled`,
    });
    if (!session.url)
      throw new AppError('PROVIDER_UNAVAILABLE', 'Stripe did not return a Checkout URL');
    return { url: session.url };
  }

  async portal(organizationId: string): Promise<{ url: string }> {
    const stripe = this.requireStripe();
    const sub = await this.subscription(organizationId);
    if (!sub?.stripeCustomerId) throw new AppError('CONFLICT', 'There is no billing account yet');
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${this.env.APP_URL}/app/settings?tab=billing`,
    });
    return { url: session.url };
  }

  // ---------------------------------------------------------------- webhooks

  /** Verifies the signature on the raw body; throws on anything that is not from Stripe. */
  constructEvent(rawBody: Buffer, signature: string | undefined): Stripe.Event {
    const stripe = this.requireStripe();
    if (!signature) throw new AppError('VALIDATION_FAILED', 'Missing Stripe-Signature header');
    try {
      return stripe.webhooks.constructEvent(rawBody, signature, this.env.STRIPE_WEBHOOK_SECRET!);
    } catch {
      throw new AppError('VALIDATION_FAILED', 'Invalid Stripe signature');
    }
  }

  /** Idempotent: Stripe retries and may deliver events twice or out of order. */
  async handle(event: Stripe.Event): Promise<void> {
    const fresh = await this.redis.set(`stripe:event:${event.id}`, '1', 'EX', EVENT_TTL_SEC, 'NX');
    if (!fresh) return;
    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await this.onCheckout(event.data.object);
          break;
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
          // Always re-read the subscription: events can arrive out of order.
          await this.syncSubscription(event.data.object.id);
          break;
        case 'invoice.paid':
          await this.onInvoicePaid(event.data.object);
          break;
        default:
          break;
      }
    } catch (err) {
      // Let Stripe retry: forget the event id.
      await this.redis.del(`stripe:event:${event.id}`);
      throw err;
    }
  }

  private async onCheckout(session: Stripe.Checkout.Session) {
    const organizationId = session.client_reference_id ?? session.metadata?.organizationId;
    const customer = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    if (!organizationId || !customer) return;
    await this.db
      .update(schema.subscriptions)
      .set({ stripeCustomerId: customer })
      .where(eq(schema.subscriptions.organizationId, organizationId));
    const subscription =
      typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (subscription) await this.syncSubscription(subscription);
  }

  /** Copies the current Stripe state of a subscription onto the organization. */
  private async syncSubscription(subscriptionId: string) {
    const stripe = this.requireStripe();
    const s = await stripe.subscriptions.retrieve(subscriptionId);
    const customer = typeof s.customer === 'string' ? s.customer : s.customer.id;
    const organizationId = await this.organizationOf(s.metadata?.organizationId, customer);
    if (!organizationId) {
      this.logger.warn({ subscriptionId }, 'Stripe subscription without a known organization');
      return;
    }
    const item = s.items.data[0];
    const status = mapStatus(s.status);
    const paidPlan = this.planOfPrice(item?.price.id);
    const plan: PlanId = status === 'canceled' || !paidPlan ? 'free' : paidPlan;
    const before = await getOrganizationPlan(this.db, organizationId);
    await this.db
      .update(schema.subscriptions)
      .set({
        plan,
        status,
        stripeCustomerId: customer,
        stripeSubscriptionId: status === 'canceled' ? null : s.id,
        cancelAtPeriodEnd: s.cancel_at_period_end,
        currentPeriodStart: item ? new Date(item.current_period_start * 1000) : new Date(),
        currentPeriodEnd: item ? new Date(item.current_period_end * 1000) : null,
      })
      .where(eq(schema.subscriptions.organizationId, organizationId));
    if (before !== plan)
      await this.audit.log({
        organizationId,
        actorUserId: null,
        action: 'billing.plan_changed',
        targetType: 'organization',
        targetId: organizationId,
        metadata: { from: before, to: plan, status },
      });
  }

  private async organizationOf(metadataOrg: string | undefined, customer: string) {
    if (metadataOrg) return metadataOrg;
    const [row] = await this.db
      .select({ organizationId: schema.subscriptions.organizationId })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.stripeCustomerId, customer));
    return row?.organizationId ?? null;
  }

  /** Every paid invoice tops the credits up to the plan's monthly amount (no rollover). */
  private async onInvoicePaid(invoice: Stripe.Invoice) {
    const details =
      invoice.parent?.type === 'subscription_details' ? invoice.parent.subscription_details : null;
    const subscriptionId =
      typeof details?.subscription === 'string' ? details.subscription : details?.subscription?.id;
    if (!subscriptionId || !invoice.id) return;
    await this.syncSubscription(subscriptionId);
    const customer = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
    const organizationId = await this.organizationOf(
      details?.metadata?.organizationId ?? undefined,
      customer ?? '',
    );
    if (!organizationId) return;
    const plan = await getOrganizationPlan(this.db, organizationId);
    if (plan === 'free') return;
    await grantMonthlyCredits(
      this.db,
      organizationId,
      plan,
      new Date(),
      `plan_grant:stripe:${invoice.id}`,
    );
  }
}
