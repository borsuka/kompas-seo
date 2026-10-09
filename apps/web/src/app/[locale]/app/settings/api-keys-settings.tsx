'use client';
import { Copy, KeyRound, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { PLANS, type ApiKey, type CreatedApiKey } from '@seo/shared';
import { Alert } from '@seo/ui/alert';
import { Badge } from '@seo/ui/badge';
import { Button } from '@seo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@seo/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@seo/ui/dialog';
import { Input } from '@seo/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@seo/ui/select';
import { Skeleton } from '@seo/ui/skeleton';
import { toast } from '@seo/ui/sonner';
import { FormMessage } from '@/components/auth/auth-card';
import { ResponsiveTable, type Column } from '@/components/responsive-table';
import { EmptyState, ErrorState } from '@/components/states';
import { Link } from '@/i18n/navigation';
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/lib/account-api';
import { useCan, useMe } from '@/lib/queries';
import { useErrorMessage } from '@/lib/use-error-message';

type KeyRole = 'member' | 'viewer';

const noSubscribe = () => () => {};

export function ApiKeysSettings() {
  const t = useTranslations();
  const format = useFormatter();
  const can = useCan();
  const me = useMe();
  const errorMessage = useErrorMessage();
  const canRead = can('apiKey:read');
  const canManage = can('apiKey:manage');
  const plan = me.data?.activeOrganization?.plan;
  const included = plan ? PLANS[plan].apiAccess : false;
  const keys = useApiKeys(canRead);
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();
  const [name, setName] = useState('');
  const [role, setRole] = useState<KeyRole>('viewer');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  // Empty on the server, so the server render and hydration match.
  const origin = useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => '',
  );

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setCreated(await create.mutateAsync({ name: name.trim(), role }));
      setName('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const columns: Column<ApiKey>[] = [
    {
      key: 'name',
      header: t('settings.apiKeys.name'),
      primary: true,
      cell: (k) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{k.name}</div>
          <code className="text-muted-foreground text-xs">{k.prefix}…</code>
        </div>
      ),
    },
    {
      key: 'role',
      header: t('settings.apiKeys.role'),
      cell: (k) => <Badge variant="outline">{t(`roles.${k.role}`)}</Badge>,
    },
    { key: 'createdBy', header: t('settings.apiKeys.createdBy'), cell: (k) => k.createdBy.name },
    {
      key: 'lastUsed',
      header: t('settings.apiKeys.lastUsed'),
      cell: (k) =>
        k.lastUsedAt
          ? format.relativeTime(new Date(k.lastUsedAt))
          : t('settings.apiKeys.neverUsed'),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: t('settings.apiKeys.actions'),
            align: 'right' as const,
            cell: (k: ApiKey) => (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('settings.apiKeys.revoke', { name: k.name })}
                disabled={revoke.isPending}
                onClick={() => {
                  if (!window.confirm(t('settings.apiKeys.revokeConfirm', { name: k.name })))
                    return;
                  revoke.mutate(k.id, {
                    onSuccess: () => toast.success(t('settings.apiKeys.revoked')),
                    onError: (err) => toast.error(errorMessage(err)),
                  });
                }}
              >
                <Trash2 aria-hidden />
              </Button>
            ),
          },
        ]
      : []),
  ];

  if (!canRead) return <Alert variant="info">{t('settings.apiKeys.noAccess')}</Alert>;

  return (
    <div className="space-y-6">
      {!included && (
        <Alert variant="info" className="flex-col sm:flex-row sm:items-center sm:justify-between">
          <span>{t('settings.apiKeys.planRequired')}</span>
          <Button size="sm" variant="outline" asChild>
            <Link href="/app/settings?tab=billing">{t('settings.apiKeys.seePlans')}</Link>
          </Button>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t('settings.apiKeys.title')}</h2>
          </CardTitle>
          <CardDescription>{t('settings.apiKeys.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canManage && included && (
            <form onSubmit={onCreate} className="flex flex-col gap-2 sm:flex-row">
              <Input
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('settings.apiKeys.namePlaceholder')}
                aria-label={t('settings.apiKeys.name')}
              />
              <Select value={role} onValueChange={(v) => setRole(v as KeyRole)}>
                <SelectTrigger className="w-40" aria-label={t('settings.apiKeys.role')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['viewer', 'member'] as const).map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`roles.${r}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="submit" disabled={!name.trim() || create.isPending}>
                {t('settings.apiKeys.create')}
              </Button>
            </form>
          )}
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <p className="text-muted-foreground text-sm">{t('settings.apiKeys.roleHelp')}</p>

          {keys.error ? (
            <ErrorState error={keys.error} onRetry={() => keys.refetch()} />
          ) : keys.isPending ? (
            <Skeleton className="h-24" />
          ) : keys.data.length === 0 ? (
            <EmptyState
              icon={KeyRound}
              title={t('settings.apiKeys.emptyTitle')}
              description={t('settings.apiKeys.empty')}
            />
          ) : (
            <ResponsiveTable
              columns={columns}
              rows={keys.data}
              rowKey={(k) => k.id}
              caption={t('settings.apiKeys.title')}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t('settings.apiKeys.usageTitle')}</h2>
          </CardTitle>
          <CardDescription>{t('settings.apiKeys.usage')}</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs">
            <code>{`curl -H "Authorization: Bearer ks_…" ${origin}/api/v1/projects`}</code>
          </pre>
          <p className="text-muted-foreground mt-2 text-sm">{t('settings.apiKeys.docs')}</p>
        </CardContent>
      </Card>

      <Dialog open={!!created} onOpenChange={(open) => !open && setCreated(null)}>
        <DialogContent closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle>{t('settings.apiKeys.createdTitle')}</DialogTitle>
            <DialogDescription>{t('settings.apiKeys.createdBody')}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={created?.key ?? ''} aria-label={t('settings.apiKeys.key')} />
            <Button
              variant="outline"
              size="icon"
              aria-label={t('settings.apiKeys.copy')}
              onClick={async () => {
                await navigator.clipboard.writeText(created?.key ?? '');
                toast.success(t('settings.apiKeys.copied'));
              }}
            >
              <Copy aria-hidden />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setCreated(null)}>{t('settings.apiKeys.done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
