'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button } from '@seo/ui/button';
import { Input } from '@seo/ui/input';
import { AuthCard, FormField, FormMessage } from '@/components/auth/auth-card';
import { Link } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';

export default function ForgotPasswordPage() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    // Always show the same message: never reveal whether an account exists.
    await authClient.requestPasswordReset({
      email,
      redirectTo: `${locale === 'bg' ? '' : `/${locale}`}/reset-password`,
    });
    setPending(false);
    setSent(true);
  }

  return (
    <AuthCard
      title={t('resetTitle')}
      description={t('resetSubtitle')}
      footer={
        <Link href="/sign-in" className="text-primary font-medium hover:underline">
          {t('signIn')}
        </Link>
      }
    >
      {sent ? (
        <FormMessage tone="success">{t('resetLinkSent')}</FormMessage>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <FormField id="email" label={t('email')}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>
          <Button type="submit" className="w-full" disabled={pending || !email}>
            {t('sendResetLink')}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
