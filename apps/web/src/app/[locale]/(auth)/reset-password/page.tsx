'use client';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Button } from '@seo/ui/button';
import { Input } from '@seo/ui/input';
import { AuthCard, FormField, FormMessage } from '@/components/auth/auth-card';
import { useAuthErrorMessage } from '@/components/auth/auth-errors';
import { Link } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';

function ResetPasswordForm() {
  const t = useTranslations('auth');
  const params = useSearchParams();
  const token = params.get('token');
  const authError = useAuthErrorMessage();
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(params.get('error') ? t('invalidToken') : null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return setError(t('invalidToken'));
    if (password.length < 8) return setError(t('passwordHint'));
    setPending(true);
    const { error: err } = await authClient.resetPassword({ newPassword: password, token });
    setPending(false);
    if (err) setError(authError(err));
    else setDone(true);
  }

  return (
    <AuthCard
      title={t('setNewPassword')}
      footer={
        <Link href="/sign-in" className="text-primary font-medium hover:underline">
          {t('signIn')}
        </Link>
      }
    >
      {done ? (
        <FormMessage tone="success">{t('passwordChanged')}</FormMessage>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <FormField id="password" label={t('newPassword')} hint={t('passwordHint')}>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
          <Button type="submit" className="w-full" disabled={pending || !token}>
            {t('setNewPassword')}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
