import type { ProviderOperation } from '@seo/shared';
import type { CallMeta } from '../context.js';
import type { ProviderKind } from '../types.js';

export interface ProviderCall {
  kind: ProviderKind;
  method: string;
  provider: string;
  operation: ProviderOperation;
  args: readonly unknown[];
  /** Stable hash of provider + method + args; used for cache, dedup and usage rows. */
  key: string;
  ttlSec: number;
  units: number;
  meta: CallMeta;
}

export type Next = () => Promise<unknown>;
export type Middleware = (call: ProviderCall, next: Next) => Promise<unknown>;
