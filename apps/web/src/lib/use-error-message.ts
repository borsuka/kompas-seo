'use client';
import { useTranslations } from 'next-intl';
import { ApiError } from './api';

const KNOWN = new Set([
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INSUFFICIENT_CREDITS',
  'PLAN_LIMIT_REACHED',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_NOT_CONFIGURED',
  'NO_ACTIVE_ORGANIZATION',
  'INTERNAL',
]);

/** Maps any error to a translated, user-facing message. */
export function useErrorMessage() {
  const t = useTranslations('errors');
  return (err: unknown): string => {
    if (err instanceof ApiError) {
      if (err.code === 'NETWORK') return t('network');
      if (err.code === 'INSUFFICIENT_CREDITS') {
        const d = (err.details ?? {}) as { required?: number; balance?: number };
        return t('INSUFFICIENT_CREDITS', { required: d.required ?? 0, balance: d.balance ?? 0 });
      }
      if (KNOWN.has(err.code)) return t(err.code as 'INTERNAL');
    }
    return t('generic');
  };
}
