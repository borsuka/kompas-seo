'use client';
import { Download, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Alert } from '@seo/ui/alert';
import { Button } from '@seo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@seo/ui/card';
import { Input } from '@seo/ui/input';
import { FormField, FormMessage } from '@/components/auth/auth-card';
import {
  accountExportUrl,
  organizationExportUrl,
  useDeleteAccount,
  useDeleteOrganization,
  useDeletionCheck,
} from '@/lib/account-api';
import { authClient } from '@/lib/auth-client';
import { useCan, useMe } from '@/lib/queries';
import { useErrorMessage } from '@/lib/use-error-message';

/** Full page loads after deletion: the session and cached queries are stale. */
const localized = (path: string) =>
  window.location.pathname.startsWith('/en') ? `/en${path}` : path;

export function PrivacySettings() {
  const t = useTranslations('settings.privacy');
  const can = useCan();
  const me = useMe();
  const isOwner = can('organization:delete');

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t('exportTitle')}</h2>
          </CardTitle>
          <CardDescription>{t('exportBody')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" asChild>
            <a href={accountExportUrl} download>
              <Download aria-hidden /> {t('exportAccount')}
            </a>
          </Button>
          {isOwner && (
            <Button variant="outline" asChild>
              <a href={organizationExportUrl} download>
                <Download aria-hidden /> {t('exportOrganization')}
              </a>
            </Button>
          )}
        </CardContent>
      </Card>

      {isOwner && me.data?.activeOrganization && (
        <DeleteOrganization name={me.data.activeOrganization.name} />
      )}
      {me.data && <DeleteAccount email={me.data.user.email} />}
    </div>
  );
}

function DeleteOrganization({ name }: { name: string }) {
  const t = useTranslations('settings.privacy');
  const errorMessage = useErrorMessage();
  const remove = useDeleteOrganization();
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await remove.mutateAsync(confirm.trim());
      // The active organization is gone: start over from the app root.
      window.location.assign(localized('/app'));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>
          <h2>{t('deleteOrgTitle')}</h2>
        </CardTitle>
        <CardDescription>{t('deleteOrgBody', { name })}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="max-w-md space-y-4">
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <FormField id="confirm-org" label={t('typeName', { name })}>
            <Input
              id="confirm-org"
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </FormField>
          <Button
            type="submit"
            variant="destructive"
            disabled={confirm.trim() !== name || remove.isPending}
          >
            <Trash2 aria-hidden /> {t('deleteOrg')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function DeleteAccount({ email }: { email: string }) {
  const t = useTranslations('settings.privacy');
  const errorMessage = useErrorMessage();
  const [open, setOpen] = useState(false);
  const check = useDeletionCheck(open);
  const remove = useDeleteAccount();
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const blocked = (check.data?.mustTransfer.length ?? 0) > 0;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await remove.mutateAsync(confirm.trim());
      await authClient.signOut().catch(() => undefined);
      window.location.assign(localized('/sign-in'));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>
          <h2>{t('deleteAccountTitle')}</h2>
        </CardTitle>
        <CardDescription>{t('deleteAccountBody')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!open ? (
          <Button variant="outline" onClick={() => setOpen(true)}>
            {t('deleteAccountStart')}
          </Button>
        ) : (
          <>
            {blocked && (
              <Alert variant="destructive">
                {t('mustTransfer', {
                  names: check.data!.mustTransfer.map((o) => o.name).join(', '),
                })}
              </Alert>
            )}
            {!!check.data?.deletedWithAccount.length && (
              <Alert>
                {t('deletedWithAccount', {
                  names: check.data.deletedWithAccount.map((o) => o.name).join(', '),
                })}
              </Alert>
            )}
            <form onSubmit={onSubmit} className="max-w-md space-y-4">
              {error && <FormMessage tone="error">{error}</FormMessage>}
              <FormField id="confirm-email" label={t('typeEmail', { email })}>
                <Input
                  id="confirm-email"
                  type="email"
                  autoComplete="off"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </FormField>
              <Button
                type="submit"
                variant="destructive"
                disabled={
                  blocked ||
                  check.isPending ||
                  confirm.trim().toLowerCase() !== email.toLowerCase() ||
                  remove.isPending
                }
              >
                <Trash2 aria-hidden /> {t('deleteAccount')}
              </Button>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}
