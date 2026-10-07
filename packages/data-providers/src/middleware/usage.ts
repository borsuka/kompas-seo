import { computeCreditCost, type CreditCost, type ProviderOperation } from '@seo/shared';
import { getProviderContext } from '../context.js';
import type { UsageSink } from '../usage.js';
import type { Middleware } from './types.js';

/** Records every call (cached or not, success or failure) to `provider_usage`. Outermost. */
export function withUsageRecording(
  sink: UsageSink,
  creditCosts: Record<ProviderOperation, CreditCost>,
  now: () => number = Date.now,
): Middleware {
  return async (call, next) => {
    const started = now();
    let success = false;
    try {
      const value = await next();
      success = true;
      return value;
    } finally {
      sink.record({
        orgId: getProviderContext()?.orgId ?? 'system',
        provider: call.provider,
        endpoint: `${call.kind}.${call.method}`,
        costUsd: call.meta.cached ? 0 : call.meta.costUsd,
        credits: computeCreditCost(creditCosts[call.operation], call.units),
        cached: call.meta.cached,
        success,
        latencyMs: now() - started,
        requestHash: call.key,
        createdAt: new Date(started),
      });
    }
  };
}
