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

export function SignInForm({ googleEnabled }: { googleEnabled: boolean }) {
  const t = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const authError = useAuthErrorMessage();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<'password' | 'magic' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** `next` may already contain the locale prefix (it comes from the proxy). */
  const absoluteNext = next.startsWith('/en/') || locale === 'bg' ? next : `/${locale}${next}`;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending('password');
    setError(null);
    const { error: err } = await authClient.signIn.email({ email, password });
    setPending(null);
    if (err) {
      if (err.code === 'EMAIL_NOT_VERIFIED') {
        router.push(`/verify-email?email=${encodeURIComponent(email)}`);
        return;
      }
      setError(authError(err));
      return;
    }
    window.location.assign(absoluteNext);
  }

  async function onMagicLink() {
    if (!email) return;
    setPending('magic');
    setError(null);
    const { error: err } = await authClient.signIn.magicLink({ email, callbackURL: absoluteNext });
    setPending(null);
    if (err) setError(authError(err));
    else setNotice(t('magicLinkSent'));
  }

  return (
    <AuthCard
      title={t('signInTitle')}
      description={t('signInSubtitle')}
      footer={
        <span>
          {t('noAccount')}{' '}
          <Link
            href={`/sign-up${next !== '/app' ? `?next=${encodeURIComponent(next)}` : ''}`}
            className="text-primary font-medium hover:underline"
          >
            {t('signUp')}
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
        {notice && <FormMessage tone="success">{notice}</FormMessage>}
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
        <FormField id="password" label={t('password')}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormField>
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-primary text-sm hover:underline">
            {t('forgotPassword')}
          </Link>
        </div>
        <Button type="submit" className="w-full" disabled={pending !== null}>
          {pending === 'password' ? t('signingIn') : t('signIn')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={pending !== null || !email}
          onClick={onMagicLink}
        >
          {t('withMagicLink')}
        </Button>
      </form>
    </AuthCard>
  );
}
