'use client';
import { useTranslations } from 'next-intl';

/** Maps Better Auth client errors to translated messages. */
export function useAuthErrorMessage() {
  const t = useTranslations();
  return (error: { code?: string; status?: number } | null | undefined): string | null => {
    if (!error) return null;
    const code = error.code ?? '';
    if (code === 'INVALID_EMAIL_OR_PASSWORD') return t('auth.invalidCredentials');
    if (code === 'EMAIL_NOT_VERIFIED') return t('auth.emailNotVerified');
    if (code.startsWith('USER_ALREADY_EXISTS')) return t('auth.emailTaken');
    if (code === 'INVALID_TOKEN') return t('auth.invalidToken');
    if (error.status === 429) return t('errors.RATE_LIMITED');
    if (error.status === 400 || error.status === 422) return t('errors.VALIDATION_FAILED');
    return t('errors.generic');
  };
}

/** Only allow same-site relative redirects (prevents open redirects via ?next=). */
export function safeNext(next: string | null | undefined, fallback = '/app'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\'))
    return fallback;
  return next;
}
