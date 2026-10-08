'use client';
import { Bell, BellOff, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import {
  RANK_ALERT_TYPES,
  type RankAlert,
  type RankAlertEvent,
  type RankAlertType,
} from '@seo/shared';
import { Button } from '@seo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@seo/ui/card';
import { Input } from '@seo/ui/input';
import { Label } from '@seo/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@seo/ui/select';
import { toast } from '@seo/ui/sonner';
import { DataTable, type DataColumn } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { Position } from '@/components/rankings/rank-badges';
import { RankingsTabs } from '@/components/rankings/rankings-tabs';
import { NoProject, useRankProject } from '@/components/rankings/use-rank-project';
import { EmptyState, ErrorState } from '@/components/states';
import { useMe, useCan } from '@/lib/queries';
import {
  useDeleteAlert,
  useRankAlertEvents,
  useRankAlerts,
  useRankings,
  useSaveAlert,
} from '@/lib/rankings-api';
import { useErrorMessage } from '@/lib/use-error-message';

const ALL = '__all__';
const DEFAULT_THRESHOLD: Record<RankAlertType, number> = {
  position_drop: 3,
  position_gain: 3,
  enter_top: 10,
  leave_top: 10,
};

export function AlertsView() {
  const t = useTranslations('rankings.alerts');
  const format = useFormatter();
  const can = useCan();
  const me = useMe();
  const errorMessage = useErrorMessage();
  const project = useRankProject();
  const alerts = useRankAlerts(project?.id);
  const events = useRankAlertEvents(project?.id);
  const tags = useRankings(project?.id, { pageSize: '1' }).data?.tags ?? [];
  const save = useSaveAlert(project?.id ?? '');
  const del = useDeleteAlert(project?.id ?? '');

  const [type, setType] = useState<RankAlertType>('position_drop');
  const [threshold, setThreshold] = useState(String(DEFAULT_THRESHOLD.position_drop));
  const [tag, setTag] = useState(ALL);
  const [emails, setEmails] = useState('');

  if (!project) return <NoProject />;
  const editable = can('rankTracking:update');
  const rule = (a: Pick<RankAlert, 'type' | 'threshold'>) =>
    t(`types.${a.type}`, { n: a.threshold });

  async function create(e: FormEvent) {
    e.preventDefault();
    const list = (emails.trim() ? emails : (me.data?.user.email ?? ''))
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await save.mutateAsync({
        type,
        threshold: Number(threshold),
        tag: tag === ALL ? null : tag,
        emails: list,
      });
      toast.success(t('created'));
      setEmails('');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const eventColumns: DataColumn<RankAlertEvent>[] = [
    {
      id: 'date',
      label: t('columns.date'),
      header: t('columns.date'),
      cell: (r) => format.dateTime(new Date(`${r.date}T00:00:00Z`), { dateStyle: 'medium' }),
    },
    {
      id: 'keyword',
      label: t('columns.keyword'),
      header: t('columns.keyword'),
      primary: true,
      cell: (r) => <span className="font-medium">{r.keyword}</span>,
    },
    {
      id: 'type',
      label: t('columns.rule'),
      header: t('columns.rule'),
      cell: (r) => t(`short.${r.type}`),
    },
    {
      id: 'change',
      label: t('columns.change'),
      header: t('columns.change'),
      cell: (r) => (
        <span className="flex items-center gap-1.5">
          <Position value={r.previousPosition} /> → <Position value={r.position} />
        </span>
      ),
    },
    {
      id: 'notified',
      label: t('columns.notified'),
      header: t('columns.notified'),
      cell: (r) =>
        r.notifiedAt ? t('sent') : <span className="text-muted-foreground">{t('notSent')}</span>,
    },
  ];

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <RankingsTabs />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>{t('rules')}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {alerts.error ? (
                <ErrorState error={alerts.error} onRetry={() => alerts.refetch()} />
              ) : alerts.data?.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t('noRules')}</p>
              ) : (
                <ul className="divide-border divide-y">
                  {alerts.data?.map((a) => (
                    <li
                      key={a.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <p
                          className={
                            a.enabled
                              ? 'font-medium'
                              : 'text-muted-foreground font-medium line-through'
                          }
                        >
                          {rule(a)}
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {a.tag ? t('forTag', { tag: a.tag }) : t('forAll')} ·{' '}
                          {a.emails.join(', ')}
                        </p>
                      </div>
                      {editable && (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => save.mutate({ id: a.id, enabled: !a.enabled })}
                            aria-label={a.enabled ? t('disable') : t('enable')}
                          >
                            {a.enabled ? <BellOff aria-hidden /> : <Bell aria-hidden />}
                            {a.enabled ? t('disable') : t('enable')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => del.mutate(a.id)}
                            aria-label={t('delete')}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">{t('events')}</h2>
            {events.error ? (
              <ErrorState error={events.error} onRetry={() => events.refetch()} />
            ) : (
              <DataTable
                columns={eventColumns}
                rows={events.data ?? []}
                rowId={(r) => r.id}
                caption={t('events')}
                loading={events.isFetching && !events.data}
                storageKey="rank-alert-events"
                empty={
                  <EmptyState icon={Bell} title={t('noEvents')} description={t('noEventsBody')} />
                }
              />
            )}
          </section>
        </div>

        {editable && (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>{t('new')}</h2>
              </CardTitle>
              <CardDescription>{t('newHint')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={create} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="alert-type">{t('type')}</Label>
                  <Select
                    value={type}
                    onValueChange={(v) => {
                      setType(v as RankAlertType);
                      setThreshold(String(DEFAULT_THRESHOLD[v as RankAlertType]));
                    }}
                  >
                    <SelectTrigger id="alert-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RANK_ALERT_TYPES.map((x) => (
                        <SelectItem key={x} value={x}>
                          {t(`short.${x}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="alert-threshold">
                    {type === 'enter_top' || type === 'leave_top' ? t('topN') : t('positions')}
                  </Label>
                  <Input
                    id="alert-threshold"
                    type="number"
                    min={1}
                    max={100}
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">
                    {rule({ type, threshold: Number(threshold) || 1 })}
                  </p>
                </div>
                {tags.length > 0 && (
                  <div className="space-y-1.5">
                    <Label htmlFor="alert-tag">{t('tag')}</Label>
                    <Select value={tag} onValueChange={setTag}>
                      <SelectTrigger id="alert-tag">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL}>{t('forAll')}</SelectItem>
                        {tags.map((x) => (
                          <SelectItem key={x} value={x}>
                            {x}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="alert-emails">{t('emails')}</Label>
                  <Input
                    id="alert-emails"
                    value={emails}
                    onChange={(e) => setEmails(e.target.value)}
                    placeholder={me.data?.user.email ?? t('emailsPlaceholder')}
                  />
                  <p className="text-muted-foreground text-xs">{t('emailsHint')}</p>
                </div>
                <Button type="submit" disabled={save.isPending} className="w-full">
                  {t('create')}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
