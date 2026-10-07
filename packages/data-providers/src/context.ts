import { AsyncLocalStorage } from 'node:async_hooks';

/** Who is making provider calls. Set by the API/worker around metered calls. */
export interface ProviderRequestContext {
  orgId: string | null;
  userId?: string | null;
  requestId?: string;
}

const requestStorage = new AsyncLocalStorage<ProviderRequestContext>();

export function withProviderContext<T>(
  ctx: ProviderRequestContext,
  fn: () => Promise<T>,
): Promise<T> {
  return requestStorage.run(ctx, fn);
}

export function getProviderContext(): ProviderRequestContext | undefined {
  return requestStorage.getStore();
}

/** Per-call accounting filled in by middleware and provider implementations. */
export interface CallMeta {
  cached: boolean;
  deduped: boolean;
  costUsd: number;
  attempts: number;
}

const callStorage = new AsyncLocalStorage<CallMeta>();

export function runWithCallMeta<T>(meta: CallMeta, fn: () => Promise<T>): Promise<T> {
  return callStorage.run(meta, fn);
}

/**
 * Called by provider implementations to report the real cost (USD) of an upstream
 * request, e.g. DataForSEO's `cost` field. Ignored outside a decorated call.
 */
export function reportProviderCost(usd: number): void {
  const meta = callStorage.getStore();
  if (meta && Number.isFinite(usd)) meta.costUsd += usd;
}
