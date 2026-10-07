import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  applyCreditEntry,
  getCreditBalance,
  getOrganizationPlan,
  listCreditLedger,
  type Database,
} from '@seo/db';
import { PLANS, type CreditLedgerEntry, type CreditsOverview, type Paginated } from '@seo/shared';
import { DB } from '../infra/tokens.js';

export interface ChargeContext {
  organizationId: string;
  userId?: string | null;
  description: string;
  refType?: string;
  refId?: string;
}

@Injectable()
export class CreditsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  balance(organizationId: string): Promise<number> {
    return getCreditBalance(this.db, organizationId);
  }

  async overview(organizationId: string): Promise<CreditsOverview> {
    const [balance, plan] = await Promise.all([
      getCreditBalance(this.db, organizationId),
      getOrganizationPlan(this.db, organizationId),
    ]);
    return { balance, plan, monthlyCredits: PLANS[plan].monthlyCredits };
  }

  async ledger(
    organizationId: string,
    page: number,
    pageSize: number,
  ): Promise<Paginated<CreditLedgerEntry>> {
    const { items, total } = await listCreditLedger(this.db, organizationId, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return {
      items: items.map((e) => ({
        id: e.id,
        delta: e.delta,
        balanceAfter: e.balanceAfter,
        reason: e.reason,
        description: e.description,
        createdAt: e.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    };
  }

  /**
   * Charges `cost` credits before `fn` runs and refunds them if it throws.
   * Throws INSUFFICIENT_CREDITS (HTTP 402) without running `fn` when the balance is too low.
   */
  async withCharge<T>(ctx: ChargeContext, cost: number, fn: () => Promise<T>): Promise<T> {
    if (cost <= 0) return fn();
    const chargeId = randomUUID();
    await applyCreditEntry(this.db, {
      organizationId: ctx.organizationId,
      delta: -cost,
      reason: 'provider_usage',
      description: ctx.description,
      refType: ctx.refType ?? null,
      refId: ctx.refId ?? null,
      idempotencyKey: `charge:${chargeId}`,
      actorUserId: ctx.userId ?? null,
    });
    try {
      return await fn();
    } catch (err) {
      await applyCreditEntry(this.db, {
        organizationId: ctx.organizationId,
        delta: cost,
        reason: 'refund',
        description: `Refund: ${ctx.description}`,
        refType: 'charge',
        refId: chargeId,
        idempotencyKey: `refund:${chargeId}`,
        actorUserId: ctx.userId ?? null,
      });
      throw err;
    }
  }
}
