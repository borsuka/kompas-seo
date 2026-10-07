'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@seo/ui/button';
import { Input } from '@seo/ui/input';
import { Separator } from '@seo/ui/separator';
import { AuthCard, FormField, FormMessage } from '@/components/auth/auth-card';
import { safeNext, useAuthErrorMessage } from '@/components/auth/auth-errors';
import { GoogleButton } from '@/components/auth/google-button';
import { Link, useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';

export function SignUpForm({ googleEnabled }: { googleEnabled: boolean }) {
  const t = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const authError = useAuthErrorMessage();
  const absoluteNext = next.startsWith('/en/') || locale === 'bg' ? next : `/${locale}${next}`;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t('passwordHint'));
      return;
    }
    setPending(true);
    const { data, error: err } = await authClient.signUp.email({
      name,
      email,
      password,
      locale,
      callbackURL: absoluteNext,
    });
    setPending(false);
    if (err) {
      setError(authError(err));
      return;
    }
    // Without a session token the account must be verified by email first.
    if (!data?.token) {
      router.push(`/verify-email?email=${encodeURIComponent(email)}`);
      return;
    }
    window.location.assign(absoluteNext);
  }

  return (
    <AuthCard
      title={t('signUpTitle')}
      description={t('signUpSubtitle')}
      footer={
        <span>
          {t('haveAccount')}{' '}
          <Link href="/sign-in" className="text-primary font-medium hover:underline">
            {t('signIn')}
          </Link>
        </span>
      }
    >
      {googleEnabled && (
        <>
          <GoogleButton callbackURL={absoluteNext} />
          <Separator />
        </>
      )}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <FormMessage tone="error">{error}</FormMessage>}
        <FormField id="name" label={t('name')}>
          <Input
            id="name"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
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
        <FormField id="password" label={t('password')} hint={t('passwordHint')}>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            aria-describedby="password-hint"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormField>
        <Button type="submit" className="w-full" disabled={pending || !name || !email}>
          {pending ? t('signingUp') : t('signUp')}
        </Button>
        <p className="text-muted-foreground text-xs">{t('terms')}</p>
      </form>
    </AuthCard>
  );
}
