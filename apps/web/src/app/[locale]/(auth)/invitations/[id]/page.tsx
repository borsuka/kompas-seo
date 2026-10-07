'use client';
import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { use, useState } from 'react';
import { Button } from '@seo/ui/button';
import { Skeleton } from '@seo/ui/skeleton';
import { AuthCard, FormMessage } from '@/components/auth/auth-card';
import { Link } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { useErrorMessage } from '@/lib/use-error-message';

interface InvitationDetails {
  id: string;
  email: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  status: string;
  organizationName: string;
  inviterEmail: string;
}

export default function InvitationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const session = useSession();
  const signedIn = !!session.data?.user;
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invitation = useQuery({
    queryKey: ['invitation', id],
    queryFn: () => api<InvitationDetails>(`/invitations/${id}`),
    enabled: signedIn,
    retry: false,
  });

  const next = `/invitations/${id}`;

  if (session.isPending) {
    return (
      <AuthCard title={t('invitation.title')}>
        <Skeleton className="h-20" />
      </AuthCard>
    );
  }

  if (!signedIn) {
    return (
      <AuthCard title={t('invitation.title')}>
        <p className="text-muted-foreground text-sm">{t('invitation.signInToAccept')}</p>
        <div className="flex flex-col gap-2">
          <Button asChild>
            <Link href={`/sign-in?next=${encodeURIComponent(next)}`}>{t('auth.signIn')}</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/sign-up?next=${encodeURIComponent(next)}`}>{t('auth.signUp')}</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  if (invitation.isPending) {
    return (
      <AuthCard title={t('invitation.title')}>
        <Skeleton className="h-20" />
      </AuthCard>
    );
  }

  const inv = invitation.data;
  const wrongAccount =
    invitation.error instanceof ApiError && invitation.error.status === 403
      ? t('invitation.wrongAccount')
      : null;

  if (!inv || inv.status !== 'pending') {
    return (
      <AuthCard title={t('invitation.title')}>
        <FormMessage tone="error">{wrongAccount ?? t('invitation.expired')}</FormMessage>
      </AuthCard>
    );
  }

  async function accept() {
    setAccepting(true);
    setError(null);
    try {
      const { organizationId } = await api<{ organizationId?: string }>(
        `/invitations/${id}/accept`,
        {
          method: 'POST',
        },
      );
      if (organizationId)
        await api(`/organizations/${organizationId}/activate`, { method: 'POST' });
      window.location.assign(window.location.pathname.startsWith('/en/') ? '/en/app' : '/app');
    } catch (err) {
      setError(errorMessage(err));
      setAccepting(false);
    }
  }

  return (
    <AuthCard title={t('invitation.title')}>
      <div className="flex justify-center">
        <Users className="text-primary size-10" aria-hidden />
      </div>
      <p className="text-center text-sm">
        {t('invitation.body', {
          inviter: inv.inviterEmail,
          organization: inv.organizationName,
          role: t(`roles.${inv.role}`),
        })}
      </p>
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <Button className="w-full" onClick={accept} disabled={accepting}>
        {accepting ? t('invitation.accepting') : t('invitation.accept')}
      </Button>
    </AuthCard>
  );
}
