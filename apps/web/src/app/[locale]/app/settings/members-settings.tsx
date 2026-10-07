'use client';
import { Trash2, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { canAssignRole, INVITABLE_ROLES, type Role } from '@seo/shared';
import { Alert } from '@seo/ui/alert';
import { Badge } from '@seo/ui/badge';
import { Button } from '@seo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@seo/ui/card';
import { Input } from '@seo/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@seo/ui/select';
import { Skeleton } from '@seo/ui/skeleton';
import { toast } from '@seo/ui/sonner';
import { FormMessage } from '@/components/auth/auth-card';
import { ErrorState } from '@/components/states';
import {
  useCan,
  useCancelInvitation,
  useInvitations,
  useInvite,
  useMe,
  useMembers,
  useRemoveMember,
  useUpdateMemberRole,
} from '@/lib/queries';
import { useErrorMessage } from '@/lib/use-error-message';

type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function MembersSettings() {
  const t = useTranslations();
  const format = useFormatter();
  const can = useCan();
  const me = useMe();
  const myRole = me.data?.activeOrganization?.role as Role | undefined;
  const errorMessage = useErrorMessage();
  const members = useMembers();
  const canManage = can('member:invite');
  const invitations = useInvitations(canManage);
  const invite = useInvite();
  const cancel = useCancelInvitation();
  const updateRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitableRole>('member');
  const [error, setError] = useState<string | null>(null);

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await invite.mutateAsync({ email, role });
      toast.success(t('settings.members.inviteSent', { email }));
      setEmail('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const roleSelect = (
    value: InvitableRole,
    onChange: (r: InvitableRole) => void,
    label: string,
  ) => (
    <Select value={value} onValueChange={(v) => onChange(v as InvitableRole)}>
      <SelectTrigger className="w-40" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {INVITABLE_ROLES.filter((r) => !myRole || canAssignRole(myRole, r)).map((r) => (
          <SelectItem key={r} value={r}>
            {t(`roles.${r}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-6">
      {!canManage && <Alert variant="info">{t('common.readOnly')}</Alert>}
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t('settings.members.title')}</h2>
          </CardTitle>
          <CardDescription>
            {t('settings.members.description')} {t('settings.members.roleHelp')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canManage && (
            <form onSubmit={onInvite} className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.email')}
                aria-label={t('auth.email')}
              />
              {roleSelect(role, setRole, t('settings.tabs.members'))}
              <Button type="submit" disabled={!email || invite.isPending}>
                {invite.isPending ? t('settings.members.inviting') : t('settings.members.invite')}
              </Button>
            </form>
          )}
          {error && <FormMessage tone="error">{error}</FormMessage>}

          {members.error ? (
            <ErrorState error={members.error} onRetry={() => members.refetch()} />
          ) : members.isPending ? (
            <Skeleton className="h-24" />
          ) : (
            <ul className="divide-border border-border divide-y rounded-md border">
              {members.data.map((m) => {
                const isMe = m.userId === me.data?.user.id;
                const editable = can('member:update') && !isMe && m.role !== 'owner';
                return (
                  <li
                    key={m.id}
                    className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {m.name}
                        {isMe && (
                          <span className="text-muted-foreground ml-1">
                            ({t('settings.members.you')})
                          </span>
                        )}
                      </div>
                      <div className="text-muted-foreground truncate text-xs">{m.email}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {editable ? (
                        roleSelect(
                          m.role as InvitableRole,
                          (r) =>
                            updateRole.mutate(
                              { memberId: m.id, role: r },
                              {
                                onSuccess: () => toast.success(t('settings.members.roleChanged')),
                                onError: (err) => toast.error(errorMessage(err)),
                              },
                            ),
                          t('settings.tabs.members'),
                        )
                      ) : (
                        <Badge variant="outline">{t(`roles.${m.role}`)}</Badge>
                      )}
                      {can('member:remove') && editable && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('common.remove')}
                          onClick={() => {
                            if (
                              window.confirm(
                                t('settings.members.removeConfirm', { name: m.name || m.email }),
                              )
                            ) {
                              removeMember.mutate(m.id, {
                                onError: (err) => toast.error(errorMessage(err)),
                              });
                            }
                          }}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {canManage && (invitations.data?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('settings.members.pending')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-border border-border divide-y rounded-md border">
              {invitations.data?.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm">{inv.email}</div>
                    <div className="text-muted-foreground text-xs">
                      {t(`roles.${inv.role}`)} ·{' '}
                      {t('settings.members.expires', {
                        date: format.dateTime(new Date(inv.expiresAt), { dateStyle: 'medium' }),
                      })}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('settings.members.cancelInvite')}
                    onClick={() => cancel.mutate(inv.id)}
                  >
                    <X aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
