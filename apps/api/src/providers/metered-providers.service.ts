import { Inject, Injectable } from '@nestjs/common';
import {
  describeCall,
  withProviderContext,
  type MethodName,
  type ProviderKind,
  type ProviderSet,
} from '@seo/data-providers';
import { computeCreditCost, resolveCreditCosts } from '@seo/shared';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { CreditsService } from '../credits/credits.service.js';
import { PROVIDERS } from '../infra/tokens.js';

type Method<K extends ProviderKind> = MethodName<K> & keyof ProviderSet[K];
type Fn<K extends ProviderKind, M extends Method<K>> = ProviderSet[K][M] extends (
  ...args: infer A
) => infer R
  ? { args: A; result: Awaited<R> }
  : never;

export interface CallerContext {
  organizationId: string;
  userId?: string | null;
  requestId?: string;
}

/**
 * The only entry point application code uses to fetch third-party data.
 * Prices the call, charges credits up front (refunding on failure) and runs the
 * provider inside the caller's org context so usage is attributed correctly.
 */
@Injectable()
export class MeteredProviders {
  private readonly costs;

  constructor(
    @Inject(PROVIDERS) private readonly providers: ProviderSet,
    @Inject(API_ENV) env: ApiEnv,
    private readonly credits: CreditsService,
  ) {
    this.costs = resolveCreditCosts(env.CREDIT_COSTS_JSON);
  }

  /** Credits a call would cost (for UI previews and pre-checks). */
  price<K extends ProviderKind, M extends Method<K>>(
    kind: K,
    method: M,
    ...args: Fn<K, M>['args']
  ): number {
    const { operation, units } = describeCall(kind, method, args);
    return computeCreditCost(this.costs[operation], units);
  }

  async call<K extends ProviderKind, M extends Method<K>>(
    ctx: CallerContext,
    kind: K,
    method: M,
    ...args: Fn<K, M>['args']
  ): Promise<Fn<K, M>['result']> {
    const { operation, units } = describeCall(kind, method, args);
    const cost = computeCreditCost(this.costs[operation], units);
    const impl = this.providers[kind][method] as unknown as (
      ...a: unknown[]
    ) => Promise<Fn<K, M>['result']>;

    return this.credits.withCharge(
      {
        organizationId: ctx.organizationId,
        userId: ctx.userId ?? null,
        description: operation,
        refType: 'provider',
        refId: `${kind}.${method}`,
      },
      cost,
      () =>
        withProviderContext(
          { orgId: ctx.organizationId, userId: ctx.userId ?? null, requestId: ctx.requestId },
          () => impl.apply(this.providers[kind], args),
        ),
    );
  }
}
