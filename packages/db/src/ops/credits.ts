import { and, desc, eq, sql } from 'drizzle-orm';
import { AppError, type CreditReason, type InsufficientCreditsDetails } from '@seo/shared';
import type { Database, DbExecutor } from '../client.js';
import { creditLedger, orgCreditBalances } from '../schema/app.js';

export interface CreditEntryInput {
  organizationId: string;
  delta: number;
  reason: CreditReason;
  description?: string | null;
  refType?: string | null;
  refId?: string | null;
  /** Retry-safe: an entry with the same key is applied at most once per organization. */
  idempotencyKey?: string | null;
  actorUserId?: string | null;
}

export interface CreditEntryResult {
  applied: boolean;
  balance: number;
  entryId: string | null;
}

export async function getCreditBalance(db: DbExecutor, organizationId: string): Promise<number> {
  const [row] = await db
    .select({ balance: orgCreditBalances.balance })
    .from(orgCreditBalances)
    .where(eq(orgCreditBalances.organizationId, organizationId));
  return row?.balance ?? 0;
}

/**
 * Applies a ledger entry atomically: locks the org balance row, rejects overdrafts,
 * writes the ledger row and updates the cached balance in one transaction.
 */
export async function applyCreditEntry(
  db: Database,
  input: CreditEntryInput,
): Promise<CreditEntryResult> {
  if (!Number.isInteger(input.delta)) throw new Error('Credit delta must be an integer');

  return db.transaction(async (tx) => {
    if (input.idempotencyKey) {
      const [existing] = await tx
        .select({ id: creditLedger.id })
        .from(creditLedger)
        .where(
          and(
            eq(creditLedger.organizationId, input.organizationId),
            eq(creditLedger.idempotencyKey, input.idempotencyKey),
          ),
        );
      if (existing) {
        return {
          applied: false,
          balance: await getCreditBalance(tx, input.organizationId),
          entryId: existing.id,
        };
      }
    }

    await tx
      .insert(orgCreditBalances)
      .values({ organizationId: input.organizationId, balance: 0 })
      .onConflictDoNothing();
    const [locked] = await tx
      .select({ balance: orgCreditBalances.balance })
      .from(orgCreditBalances)
      .where(eq(orgCreditBalances.organizationId, input.organizationId))
      .for('update');
    const current = locked?.balance ?? 0;
    const next = current + input.delta;
    if (next < 0) {
      const details: InsufficientCreditsDetails = { required: -input.delta, balance: current };
      throw new AppError('INSUFFICIENT_CREDITS', 'Not enough credits for this request', details);
    }

    const inserted = await tx
      .insert(creditLedger)
      .values({
        organizationId: input.organizationId,
        delta: input.delta,
        balanceAfter: next,
        reason: input.reason,
        description: input.description ?? null,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        actorUserId: input.actorUserId ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: creditLedger.id });
    if (!inserted[0]) {
      // Lost a race on the idempotency key: nothing applied.
      return { applied: false, balance: current, entryId: null };
    }

    await tx
      .update(orgCreditBalances)
      .set({ balance: sql`${orgCreditBalances.balance} + ${input.delta}` })
      .where(eq(orgCreditBalances.organizationId, input.organizationId));

    return { applied: true, balance: next, entryId: inserted[0].id };
  });
}

export async function listCreditLedger(
  db: DbExecutor,
  organizationId: string,
  opts: { limit: number; offset: number },
) {
  const [items, [total]] = await Promise.all([
    db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.organizationId, organizationId))
      .orderBy(desc(creditLedger.createdAt))
      .limit(opts.limit)
      .offset(opts.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(creditLedger)
      .where(eq(creditLedger.organizationId, organizationId)),
  ]);
  return { items, total: total?.count ?? 0 };
}

/** Idempotency key for the plan grant of a given billing month (YYYY-MM, UTC). */
export function planGrantKey(date: Date = new Date()): string {
  return `plan_grant:${date.toISOString().slice(0, 7)}`;
}
