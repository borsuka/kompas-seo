'use client';
import { FolderPlus, Plug, RefreshCw, SearchX, Unplug } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Calibration, Cannibalization, GscPerformance } from '@seo/shared';
import { Button } from '@seo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@seo/ui/card';
import { Input } from '@seo/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@seo/ui/select';
import { Skeleton } from '@seo/ui/skeleton';
import { toast } from '@seo/ui/sonner';
import { useCurrentProject } from '@/components/app-shell/project-context';
import { UrlCell } from '@/components/competitors/position';
import { Segmented } from '@/components/competitors/segmented';
import { ContentTabs } from '@/components/content/content-tabs';
import { DataTable, Pagination, type DataColumn } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState } from '@/components/states';
import { Link } from '@/i18n/navigation';
import {
  useGsc,
  useGscConnect,
  useGscDisconnect,
  useGscReport,
  useGscSelectSite,
  useGscSites,
  useGscSync,
} from '@/lib/content-api';
import { useCan } from '@/lib/queries';
import { useErrorMessage } from '@/lib/use-error-message';
import { useSearchState } from '@/lib/use-search-state';

const tooltipStyle = {
  background: 'var(--color-popover)',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  color: 'var(--color-popover-foreground)',
};
type Row = GscPerformance['rows'][number];
type Issue = Cannibalization['issues'][number];
type CalRow = Calibration['rows'][number];

function Delta({
  now,
  before,
  invert = false,
}: {
  now: number | null;
  before: number | null;
  invert?: boolean;
}) {
  const format = useFormatter();
  if (now === null || before === null || before === 0) return null;
  const change = (now - before) / before;
  const good = invert ? change < 0 : change > 0;
  return (
    <span
      className={good ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}
    >
      {format.number(change, {
        style: 'percent',
        signDisplay: 'exceptZero',
        maximumFractionDigits: 1,
      })}
    </span>
  );
}

export function SearchConsoleView() {
  const t = useTranslations('content.gsc');
  const format = useFormatter();
  const can = useCan();
  const errorMessage = useErrorMessage();
  const { current } = useCurrentProject();
  const { params, set } = useSearchState();
  const [search, setSearch] = useState(params.q ?? '');
  const tab = (params.tab ?? 'performance') as 'performance' | 'cannibalization' | 'calibration';
  const days = params.days ?? '28';
  const by = (params.by ?? 'query') as 'query' | 'page';

  const status = useGsc(current?.id);
  const s = status.data;
  const active = s?.status === 'active';
  const connect = useGscConnect(current?.id ?? '');
  const selectSite = useGscSelectSite(current?.id ?? '');
  const sync = useGscSync(current?.id ?? '');
  const disconnect = useGscDisconnect(current?.id ?? '');
  const sites = useGscSites(current?.id, s?.status === 'pending_site');
  const perf = useGscReport<GscPerformance>(
    current?.id,
    'performance',
    { days, by, q: params.q, page: params.page ?? '1', pageSize: '50' },
    active && tab === 'performance',
  );
  const cannibal = useGscReport<Cannibalization>(
    current?.id,
    'cannibalization',
    { days },
    active && tab === 'cannibalization',
  );
  const calibration = useGscReport<Calibration>(
    current?.id,
    'calibration',
    { days },
    active && tab === 'calibration',
  );
  const editable = can('project:update');

  // Result of the Google OAuth redirect (?gsc=connected|choose_site|denied|…).
  const outcome = params.gsc;
  useEffect(() => {
    if (!outcome) return;
    if (outcome === 'connected' || outcome === 'choose_site')
      toast.success(t(`outcome.${outcome}`));
    else
      toast.error(
        t(
          `outcome.${outcome === 'denied' || outcome === 'no_refresh_token' || outcome === 'not_configured' || outcome === 'invalid_state' ? outcome : 'failed'}`,
        ),
      );
    set({ gsc: null, project: null });
  }, [outcome, set, t]);

  if (!current)
    return (
      <>
        <PageHeader title={t('title')} />
        <ContentTabs />
        <EmptyState
          icon={FolderPlus}
          title={t('noProject')}
          action={
            <Button asChild>
              <Link href="/onboarding">{t('createProject')}</Link>
            </Button>
          }
        />
      </>
    );

  async function startConnect() {
    try {
      const res = await connect.mutateAsync();
      if (res.url) window.location.assign(res.url);
      else toast.success(t('connected'));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const rowColumns: DataColumn<Row>[] = [
    {
      id: 'key',
      label: by === 'query' ? t('columns.query') : t('columns.page'),
      header: by === 'query' ? t('columns.query') : t('columns.page'),
      primary: true,
      cell: (r) =>
        by === 'query' ? <span className="font-medium">{r.key}</span> : <UrlCell url={r.key} />,
    },
    {
      id: 'clicks',
      label: t('columns.clicks'),
      header: t('columns.clicks'),
      align: 'right',
      cell: (r) => format.number(r.clicks),
    },
    {
      id: 'impressions',
      label: t('columns.impressions'),
      header: t('columns.impressions'),
      align: 'right',
      cell: (r) => format.number(r.impressions),
    },
    {
      id: 'ctr',
      label: t('columns.ctr'),
      header: t('columns.ctr'),
      align: 'right',
      cell: (r) => format.number(r.ctr, { style: 'percent', maximumFractionDigits: 1 }),
    },
    {
      id: 'position',
      label: t('columns.position'),
      header: t('columns.position'),
      align: 'right',
      cell: (r) => format.number(r.position, { maximumFractionDigits: 1 }),
    },
  ];

  const issueColumns: DataColumn<Issue>[] = [
    {
      id: 'query',
      label: t('columns.query'),
      header: t('columns.query'),
      primary: true,
      cell: (r) => (
        <span className="flex flex-col gap-1">
          <span className="font-medium">{r.query}</span>
          <span
            className={
              r.severity === 'high'
                ? 'text-xs text-red-600 dark:text-red-400'
                : 'text-xs text-amber-700 dark:text-amber-300'
            }
          >
            {t(`severity.${r.severity}`)}
          </span>
        </span>
      ),
    },
    {
      id: 'pages',
      label: t('columns.pages'),
      header: t('columns.pages'),
      cell: (r) => (
        <ul className="space-y-1">
          {r.pages.map((p) => (
            <li key={p.page} className="flex items-center gap-2">
              <UrlCell url={p.page} />
              <span className="text-muted-foreground tabular text-xs">
                {t('pageShare', {
                  share: format.number(p.share, { style: 'percent' }),
                  position: format.number(p.position, { maximumFractionDigits: 1 }),
                })}
              </span>
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: 'impressions',
      label: t('columns.impressions'),
      header: t('columns.impressions'),
      align: 'right',
      cell: (r) => format.number(r.impressions),
    },
    {
      id: 'clicks',
      label: t('columns.clicks'),
      header: t('columns.clicks'),
      align: 'right',
      cell: (r) => format.number(r.clicks),
    },
  ];

  const calColumns: DataColumn<CalRow>[] = [
    {
      id: 'keyword',
      label: t('columns.query'),
      header: t('columns.query'),
      primary: true,
      cell: (r) => <span className="font-medium">{r.keyword}</span>,
    },
    {
      id: 'position',
      label: t('columns.position'),
      header: t('columns.position'),
      align: 'right',
      cell: (r) => (r.position === null ? '–' : r.position),
    },
    {
      id: 'volume',
      label: t('columns.volume'),
      header: t('columns.volume'),
      align: 'right',
      cell: (r) => format.number(r.volume),
    },
    {
      id: 'estimated',
      label: t('columns.estimated'),
      header: t('columns.estimated'),
      align: 'right',
      cell: (r) => format.number(Math.round(r.estimatedClicks)),
    },
    {
      id: 'actual',
      label: t('columns.actual'),
      header: t('columns.actual'),
      align: 'right',
      cell: (r) => format.number(Math.round(r.actualClicks)),
    },
  ];

  const p = perf.data;
  const chart = (p?.daily ?? []).map((d) => ({
    ...d,
    label: format.dateTime(new Date(`${d.date}T00:00:00Z`), { day: 'numeric', month: 'short' }),
  }));

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description', { domain: current.domain })}
        actions={
          s?.connected &&
          editable && (
            <>
              {active && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => sync.mutate()}
                  disabled={sync.isPending}
                >
                  <RefreshCw aria-hidden /> {t('sync')}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.confirm(t('confirmDisconnect')) && disconnect.mutate()}
              >
                <Unplug aria-hidden /> {t('disconnect')}
              </Button>
            </>
          )
        }
      />
      <ContentTabs />

      {status.error ? (
        <ErrorState error={status.error} onRetry={() => status.refetch()} />
      ) : !s ? (
        <Skeleton className="h-40" />
      ) : !s.connected || s.status === 'error' ? (
        <EmptyState
          icon={Plug}
          title={s.status === 'error' ? t('reconnectTitle') : t('connectTitle')}
          description={s.provider === 'mock' ? t('connectMockBody') : t('connectBody')}
          action={
            editable ? (
              <Button onClick={startConnect} disabled={connect.isPending}>
                <Plug aria-hidden /> {t('connect')}
              </Button>
            ) : (
              <p className="text-muted-foreground text-sm">{t('viewerHint')}</p>
            )
          }
        />
      ) : s.status === 'pending_site' ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('chooseSite')}</h2>
            </CardTitle>
            <CardDescription>{t('chooseSiteBody', { domain: current.domain })}</CardDescription>
          </CardHeader>
          <CardContent>
            {sites.data?.length ? (
              <Select onValueChange={(v) => selectSite.mutate(v)} disabled={!editable}>
                <SelectTrigger className="w-80" aria-label={t('chooseSite')}>
                  <SelectValue placeholder={t('chooseSite')} />
                </SelectTrigger>
                <SelectContent>
                  {sites.data.map((x) => (
                    <SelectItem key={x.siteUrl} value={x.siteUrl}>
                      {x.siteUrl}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-muted-foreground text-sm">
                {sites.isLoading ? '…' : t('noSites')}
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              label={t('reports')}
              value={tab}
              onChange={(v) => set({ tab: v === 'performance' ? null : v })}
              options={(['performance', 'cannibalization', 'calibration'] as const).map((v) => ({
                value: v,
                label: t(`tabs.${v}`),
              }))}
            />
            <Segmented
              label={t('period')}
              value={days}
              onChange={(v) => set({ days: v === '28' ? null : v })}
              options={['7', '28', '90'].map((v) => ({
                value: v,
                label: t('days', { count: Number(v) }),
              }))}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            {t('site', { site: s.siteUrl ?? '' })}
            {s.lastSyncAt &&
              ` · ${t('lastSync', { date: format.dateTime(new Date(s.lastSyncAt), { dateStyle: 'medium', timeStyle: 'short' }) })}`}
            {s.dataUntil &&
              ` · ${t('dataUntil', { date: format.dateTime(new Date(`${s.dataUntil}T00:00:00Z`), { dateStyle: 'medium' }) })}`}
          </p>

          {tab === 'performance' &&
            (perf.error ? (
              <ErrorState error={perf.error} onRetry={() => perf.refetch()} />
            ) : !p ? (
              <Skeleton className="h-72" />
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {(
                    [
                      [
                        'clicks',
                        format.number(p.totals.clicks),
                        p.totals.clicks,
                        p.previous.clicks,
                        false,
                      ],
                      [
                        'impressions',
                        format.number(p.totals.impressions),
                        p.totals.impressions,
                        p.previous.impressions,
                        false,
                      ],
                      [
                        'ctr',
                        format.number(p.totals.ctr, { style: 'percent', maximumFractionDigits: 1 }),
                        p.totals.ctr,
                        p.previous.ctr,
                        false,
                      ],
                      [
                        'position',
                        p.totals.position === null
                          ? '–'
                          : format.number(p.totals.position, { maximumFractionDigits: 1 }),
                        p.totals.position,
                        p.previous.position,
                        true,
                      ],
                    ] as const
                  ).map(([key, value, now, before, invert]) => (
                    <Card key={key}>
                      <CardHeader className="pb-2">
                        <CardDescription>{t(`columns.${key}`)}</CardDescription>
                        <CardTitle className="tabular text-2xl">{value}</CardTitle>
                        <div className="text-xs">
                          <Delta now={now} before={before} invert={invert} />{' '}
                          <span className="text-muted-foreground">{t('vsPrevious')}</span>
                        </div>
                      </CardHeader>
                    </Card>
                  ))}
                </div>
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <h2>{t('trend')}</h2>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-56" role="img" aria-label={t('trend')}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chart} margin={{ left: 0, right: 8, top: 8 }}>
                          <CartesianGrid vertical={false} stroke="var(--color-border)" />
                          <XAxis
                            dataKey="label"
                            tickLine={false}
                            axisLine={false}
                            fontSize={11}
                            stroke="var(--color-muted-foreground)"
                          />
                          <YAxis
                            yAxisId="c"
                            tickLine={false}
                            axisLine={false}
                            fontSize={11}
                            width={40}
                            stroke="var(--color-muted-foreground)"
                          />
                          <YAxis
                            yAxisId="i"
                            orientation="right"
                            tickLine={false}
                            axisLine={false}
                            fontSize={11}
                            width={48}
                            stroke="var(--color-muted-foreground)"
                            tickFormatter={(v: number) => format.number(v, { notation: 'compact' })}
                          />
                          <ChartTooltip
                            contentStyle={tooltipStyle}
                            formatter={(v, name) => [
                              format.number(Number(v)),
                              name === 'clicks' ? t('columns.clicks') : t('columns.impressions'),
                            ]}
                          />
                          <Line
                            yAxisId="c"
                            type="monotone"
                            dataKey="clicks"
                            stroke="var(--color-primary)"
                            strokeWidth={2}
                            dot={false}
                          />
                          <Line
                            yAxisId="i"
                            type="monotone"
                            dataKey="impressions"
                            stroke="#a855f7"
                            strokeWidth={1.5}
                            dot={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <Segmented
                    label={t('groupBy')}
                    value={by}
                    onChange={(v) => set({ by: v === 'query' ? null : v })}
                    options={(['query', 'page'] as const).map((v) => ({
                      value: v,
                      label: t(`by.${v}`),
                    }))}
                  />
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      set({ q: search.trim() || null });
                    }}
                  >
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t('search')}
                      aria-label={t('search')}
                      className="w-64"
                    />
                  </form>
                </div>
                <DataTable
                  columns={rowColumns}
                  rows={p.rows}
                  rowId={(r) => r.key}
                  caption={t('results', { count: p.total })}
                  loading={perf.isFetching}
                  storageKey={`gsc-${by}`}
                  empty={
                    <EmptyState icon={SearchX} title={t('noData')} description={t('noDataBody')} />
                  }
                  toolbar={
                    <span className="text-muted-foreground tabular text-sm">
                      {t('results', { count: p.total })}
                    </span>
                  }
                />
                <div className="flex justify-end">
                  <Pagination
                    page={p.page}
                    pageSize={p.pageSize}
                    total={p.total}
                    onPage={(n) => set({ page: n })}
                  />
                </div>
              </>
            ))}

          {tab === 'cannibalization' &&
            (cannibal.error ? (
              <ErrorState error={cannibal.error} onRetry={() => cannibal.refetch()} />
            ) : (
              <>
                <p className="text-muted-foreground text-sm">{t('cannibalHint')}</p>
                <DataTable
                  columns={issueColumns}
                  rows={cannibal.data?.issues ?? []}
                  rowId={(r) => r.query}
                  caption={t('tabs.cannibalization')}
                  loading={cannibal.isFetching && !cannibal.data}
                  storageKey="gsc-cannibalization"
                  empty={<EmptyState icon={SearchX} title={t('noCannibal')} />}
                />
              </>
            ))}

          {tab === 'calibration' &&
            (calibration.error ? (
              <ErrorState error={calibration.error} onRetry={() => calibration.refetch()} />
            ) : !calibration.data ? (
              <Skeleton className="h-40" />
            ) : (
              <>
                <Card>
                  <CardHeader>
                    <CardDescription>{t('factor')}</CardDescription>
                    <CardTitle className="tabular text-3xl">
                      ×{format.number(calibration.data.factor, { maximumFractionDigits: 2 })}
                    </CardTitle>
                    <p className="text-muted-foreground text-sm">
                      {calibration.data.source === 'none'
                        ? t('calibrationNone')
                        : t('calibrationHint', {
                            count: calibration.data.sampleSize,
                            source: t(`calibrationSource.${calibration.data.source}`),
                          })}
                      {!calibration.data.reliable &&
                        calibration.data.source !== 'none' &&
                        ` ${t('calibrationSmall')}`}
                    </p>
                  </CardHeader>
                </Card>
                <DataTable
                  columns={calColumns}
                  rows={calibration.data.rows}
                  rowId={(r) => r.keyword}
                  caption={t('tabs.calibration')}
                  storageKey="gsc-calibration"
                  empty={<EmptyState icon={SearchX} title={t('calibrationNone')} />}
                />
              </>
            ))}
        </div>
      )}
    </>
  );
}
