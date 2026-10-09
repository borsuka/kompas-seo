import type { Redis } from 'ioredis';
import type Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, getCreditBalance, schema } from '@seo/db';
import { AuditService } from '../src/audit/audit.service.js';
import { BillingService } from '../src/billing/billing.service.js';
import { loadApiEnv } from '../src/config/env.js';
import { REDIS } from '../src/infra/tokens.js';
import { resetDb, signUpWithOrg, startApp, type TestApp } from './helpers.js';

let t: TestApp;
const SECRET = 'whsec_test_secret';

beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t?.close();
});
beforeEach(async () => {
  await resetDb(t.db, t.ch);
  await t.app.get<Redis>(REDIS).flushdb();
});

/** Billing enabled against a fake Stripe subscriptions API (no network). */
function billing(subscription: () => Partial<Stripe.Subscription>) {
  const env = {
    ...loadApiEnv(),
    BILLING_ENABLED: true,
    STRIPE_SECRET_KEY: 'sk_test_fake',
    STRIPE_WEBHOOK_SECRET: SECRET,
    STRIPE_PRICE_PRO: 'price_pro',
    STRIPE_PRICE_AGENCY: 'price_agency',
  };
  const service = new BillingService(t.db, t.app.get<Redis>(REDIS), env, t.app.get(AuditService));
  const stripe = (service as unknown as { stripe: Stripe }).stripe;
  stripe.subscriptions.retrieve = (async () => subscription()) as never;
  return { service, stripe };
}

const sub = (
  orgId: string,
  over: Partial<Stripe.Subscription> = {},
): Partial<Stripe.Subscription> => ({
  id: 'sub_1',
  customer: 'cus_1',
  status: 'active',
  cancel_at_period_end: false,
  metadata: { organizationId: orgId },
  items: {
    data: [
      {
        price: { id: 'price_pro' },
        current_period_start: 1_791_000_000,
        current_period_end: 1_793_600_000,
      },
    ],
  } as never,
  ...over,
});

const event = (type: string, object: unknown, id = `evt_${Math.random()}`) =>
  ({ id, type, data: { object } }) as unknown as Stripe.Event;

describe('Billing (disabled by default)', () => {
  it('reports billing as disabled and refuses checkout', async () => {
    const owner = await signUpWithOrg(t.app);
    const overview = await owner.agent.get('/api/v1/billing').expect(200);
    expect(overview.body).toMatchObject({ enabled: false, plan: 'free', hasCustomer: false });
    expect(overview.body.plans.map((p: { id: string }) => p.id)).toEqual(['free', 'pro', 'agency']);
    const res = await owner.agent.post('/api/v1/billing/checkout').send({ plan: 'pro' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.code).toBe('PROVIDER_NOT_CONFIGURED');
  });
});

describe('Stripe webhooks', () => {
  it('verifies the signature on the raw body', async () => {
    const { service, stripe } = billing(() => ({}));
    const payload = JSON.stringify({
      id: 'evt_1',
      object: 'event',
      type: 'ping',
      data: { object: {} },
    });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    expect(service.constructEvent(Buffer.from(payload), header).id).toBe('evt_1');
    expect(() => service.constructEvent(Buffer.from(payload), 't=1,v1=bad')).toThrow(/signature/i);
    expect(() => service.constructEvent(Buffer.from(`${payload} `), header)).toThrow(/signature/i);
  });

  it('activates the plan after checkout, grants credits per paid invoice once and downgrades on cancel', async () => {
    const owner = await signUpWithOrg(t.app);
    let state = sub(owner.orgId);
    const { service } = billing(() => state);

    await service.handle(
      event('checkout.session.completed', {
        client_reference_id: owner.orgId,
        customer: 'cus_1',
        subscription: 'sub_1',
        metadata: {},
      }),
    );
    const [row] = await t.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.organizationId, owner.orgId));
    expect(row).toMatchObject({
      plan: 'pro',
      status: 'active',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
    });
    expect(row!.currentPeriodEnd?.getTime()).toBe(1_793_600_000 * 1000);

    const invoice = {
      id: 'in_1',
      customer: 'cus_1',
      parent: {
        type: 'subscription_details',
        subscription_details: { subscription: 'sub_1', metadata: {} },
      },
    };
    await service.handle(event('invoice.paid', invoice, 'evt_inv_1'));
    expect(await getCreditBalance(t.db, owner.orgId)).toBe(10_000);
    // Duplicate delivery and a second event for the same invoice do nothing.
    await service.handle(event('invoice.paid', invoice, 'evt_inv_1'));
    await service.handle(event('invoice.paid', invoice, 'evt_inv_1b'));
    expect(await getCreditBalance(t.db, owner.orgId)).toBe(10_000);

    const overview = await owner.agent.get('/api/v1/billing').expect(200);
    expect(overview.body).toMatchObject({
      plan: 'pro',
      hasCustomer: true,
      cancelAtPeriodEnd: false,
    });

    state = sub(owner.orgId, { status: 'canceled' });
    await service.handle(event('customer.subscription.deleted', { id: 'sub_1' }));
    const [after] = await t.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.organizationId, owner.orgId));
    expect(after).toMatchObject({ plan: 'free', status: 'canceled', stripeSubscriptionId: null });
    const audit = await t.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'billing.plan_changed'));
    expect(audit.map((a) => (a.metadata as { to: string }).to)).toEqual(['pro', 'free']);
  });

  it('finds the organization by customer when metadata is missing', async () => {
    const owner = await signUpWithOrg(t.app);
    await t.db
      .update(schema.subscriptions)
      .set({ stripeCustomerId: 'cus_9' })
      .where(eq(schema.subscriptions.organizationId, owner.orgId));
    const { service } = billing(() =>
      sub(owner.orgId, {
        customer: 'cus_9',
        metadata: {},
        items: {
          data: [{ price: { id: 'price_agency' }, current_period_start: 1, current_period_end: 2 }],
        } as never,
      }),
    );
    await service.handle(event('customer.subscription.updated', { id: 'sub_1' }));
    const [row] = await t.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.organizationId, owner.orgId));
    expect(row!.plan).toBe('agency');
  });
});
