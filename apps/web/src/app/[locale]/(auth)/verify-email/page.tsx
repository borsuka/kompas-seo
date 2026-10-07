'use client';
import { MailCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@seo/ui/button';
import { AuthCard, FormMessage } from '@/components/auth/auth-card';
import { authClient } from '@/lib/auth-client';

function VerifyEmail() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const email = useSearchParams().get('email') ?? '';
  const [resent, setResent] = useState(false);

  return (
    <AuthCard title={t('verifyTitle')}>
      <div className="flex justify-center">
        <MailCheck className="text-primary size-10" aria-hidden />
      </div>
      <p className="text-muted-foreground text-center text-sm">{t('verifyBody', { email })}</p>
      {resent && <FormMessage tone="success">{t('verifyResent')}</FormMessage>}
      <Button
        variant="outline"
        className="w-full"
        disabled={!email || resent}
        onClick={async () => {
          await authClient.sendVerificationEmail({
            email,
            callbackURL: locale === 'bg' ? '/app' : `/${locale}/app`,
          });
          setResent(true);
        }}
      >
        {t('verifyResend')}
      </Button>
    </AuthCard>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
