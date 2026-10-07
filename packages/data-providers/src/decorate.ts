import { createHash } from 'node:crypto';
import { runWithCallMeta, type CallMeta } from './context.js';
import type { Middleware, ProviderCall } from './middleware/types.js';
import { METHOD_SPECS, type MethodSpec, type ProviderKind, type ProviderSet } from './types.js';

/** Bump to invalidate every cached provider response after a breaking type change. */
const CACHE_VERSION = 'v1';

export function callKey(
  provider: string,
  kind: string,
  method: string,
  args: readonly unknown[],
): string {
  const hash = createHash('sha1').update(JSON.stringify(args)).digest('hex');
  return `${CACHE_VERSION}:${provider}:${kind}.${method}:${hash}`;
}

/** Describes a call without executing it (used by the API to price credits up front). */
export function describeCall(kind: ProviderKind, method: string, args: readonly unknown[]) {
  const spec = (METHOD_SPECS[kind] as Record<string, MethodSpec>)[method];
  if (!spec) throw new Error(`Unknown provider method ${kind}.${method}`);
  return { operation: spec.operation, units: spec.units(args), ttlSec: spec.ttlSec };
}

function compose(middlewares: Middleware[], call: ProviderCall, last: () => Promise<unknown>) {
  const dispatch = (i: number): Promise<unknown> =>
    i === middlewares.length ? last() : middlewares[i]!(call, () => dispatch(i + 1));
  return dispatch(0);
}

/**
 * Wraps every method of a provider with the middleware chain (first = outermost).
 * The returned object implements the same interface as the input.
 */
export function decorateProvider<K extends ProviderKind>(
  kind: K,
  provider: ProviderSet[K],
  middlewares: Middleware[],
): ProviderSet[K] {
  const specs = METHOD_SPECS[kind] as Record<string, MethodSpec>;
  const target = provider as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const wrapped: Record<string, unknown> = { name: provider.name };

  for (const [method, spec] of Object.entries(specs)) {
    const impl = target[method];
    if (typeof impl !== 'function')
      throw new Error(`${provider.name} does not implement ${kind}.${method}`);
    wrapped[method] = (...args: unknown[]) => {
      const meta: CallMeta = { cached: false, deduped: false, costUsd: 0, attempts: 0 };
      const call: ProviderCall = {
        kind,
        method,
        provider: provider.name,
        operation: spec.operation,
        args,
        key: callKey(provider.name, kind, method, args),
        ttlSec: spec.ttlSec,
        units: spec.units(args),
        meta,
      };
      return runWithCallMeta(meta, () =>
        compose(middlewares, call, () => impl.apply(provider, args)),
      );
    };
  }
  return wrapped as unknown as ProviderSet[K];
}
