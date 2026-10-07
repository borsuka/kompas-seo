import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCreditEntry, getCreditBalance } from '@seo/db';
import { AppError } from '@seo/shared';
import { PROVIDERS } from '../src/infra/tokens.js';
import { MeteredProviders } from '../src/providers/metered-providers.service.js';
import type { ProviderSet } from '@seo/data-providers';
import { resetDb, signUpWithOrg, startApp, type TestApp } from './helpers.js';

let t: TestApp;
const loc = { locationCode: 2100, languageCode: 'bg' } as const;

beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t?.close();
});
beforeEach(async () => {
  await resetDb(t.db);
});

describe('Credits', () => {
  it('grants plan credits once per month and exposes the ledger', async () => {
    const owner = await signUpWithOrg(t.app);
    const overview = await owner.agent.get('/api/v1/credits').expect(200);
    expect(overview.body).toEqual({ balance: 500, plan: 'free', monthlyCredits: 500 });

    const ledger = await owner.agent.get('/api/v1/credits/ledger').expect(200);
    expect(ledger.body.total).toBe(1);
    expect(ledger.body.items[0]).toMatchObject({
      delta: 500,
      balanceAfter: 500,
      reason: 'plan_grant',
    });
  });

  it('charges credits before a provider call and records the cost', async () => {
    const owner = await signUpWithOrg(t.app);
    const metered = t.app.get(MeteredProviders);
    const price = metered.price('keywords', 'getKeywordMetrics', ['a', 'b', 'c'], loc);
    expect(price).toBe(1);

    const result = await metered.call(
      { organizationId: owner.orgId, userId: owner.userId },
      'keywords',
      'getKeywordMetrics',
      ['seo оптимизация', 'seo софия'],
      loc,
    );
    expect(result).toHaveLength(2);
    expect(await getCreditBalance(t.db, owner.orgId)).toBe(499);

    const ledger = await owner.agent.get('/api/v1/credits/ledger').expect(200);
    expect(ledger.body.items[0]).toMatchObject({
      delta: -1,
      balanceAfter: 499,
      reason: 'provider_usage',
    });
  });

  it('refuses with INSUFFICIENT_CREDITS and never calls the provider', async () => {
    const owner = await signUpWithOrg(t.app);
    await applyCreditEntry(t.db, {
      organizationId: owner.orgId,
      delta: -495,
      reason: 'manual_adjustment',
    });
    const providers = t.app.get<ProviderSet>(PROVIDERS);
    const spy = vi.spyOn(providers.serp, 'getSerp');

    const err = await t.app
      .get(MeteredProviders)
      .call({ organizationId: owner.orgId }, 'serp', 'getSerp', 'seo', loc, 'desktop', 200)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('INSUFFICIENT_CREDITS');
    expect((err as AppError).details).toEqual({ required: 10, balance: 5 });
    expect(spy).not.toHaveBeenCalled();
    expect(await getCreditBalance(t.db, owner.orgId)).toBe(5);
  });

  it('refunds credits when the provider call fails', async () => {
    const owner = await signUpWithOrg(t.app);
    const providers = t.app.get<ProviderSet>(PROVIDERS);
    vi.spyOn(providers.backlinks, 'getBacklinkSummary').mockRejectedValueOnce(
      new Error('upstream down'),
    );

    await expect(
      t.app
        .get(MeteredProviders)
        .call({ organizationId: owner.orgId }, 'backlinks', 'getBacklinkSummary', 'x.bg'),
    ).rejects.toThrow('upstream down');
    expect(await getCreditBalance(t.db, owner.orgId)).toBe(500);

    const ledger = await owner.agent.get('/api/v1/credits/ledger').expect(200);
    expect(ledger.body.items.map((i: { reason: string }) => i.reason)).toEqual([
      'refund',
      'provider_usage',
      'plan_grant',
    ]);
  });

  it('applies idempotent entries only once, even concurrently', async () => {
    const owner = await signUpWithOrg(t.app);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        applyCreditEntry(t.db, {
          organizationId: owner.orgId,
          delta: 100,
          reason: 'manual_adjustment',
          idempotencyKey: 'bonus-1',
        }),
      ),
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await getCreditBalance(t.db, owner.orgId)).toBe(600);
  });
});
