'use client';
import { Globe } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { findLocation, type DomainKeywordRow, type TopPage } from '@seo/shared';
import { Button } from '@seo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@seo/ui/card';
import { Skeleton } from '@seo/ui/skeleton';
import { CompetitorsTabs } from '@/components/competitors/competitors-tabs';
import { DomainBar, useDomainParams } from '@/components/competitors/domain-bar';
import { PositionChange, UrlCell } from '@/components/competitors/position';
import { DataTable, type DataColumn } from '@/components/data-table';
import { IntentBadges, KdBadge } from '@/components/keywords/badges';
import { MetricLabel, type MetricKey } from '@/components/metric-tooltip';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState } from '@/components/states';
import { Link } from '@/i18n/navigation';
import { useDomainOverview } from '@/lib/domains-api';

function Metric({
  metric,
  label,
  children,
  hint,
}: {
  metric?: MetricKey;
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>
          {metric ? <MetricLabel metric={metric} label={label} /> : label}
        </CardDescription>
        <CardTitle className="tabular text-2xl">{children}</CardTitle>
        {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      </CardHeader>
    </Card>
  );
}

export function DomainOverviewView() {
  const t = useTranslations('competitors');
  const tc = useTranslations('countries');
  const format = useFormatter();
  const { domain, loc, lang } = useDomainParams();
  const overview = useDomainOverview({ domain: domain || undefined, loc: String(loc), lang });
  const o = overview.data;
  const n = (v: number | null | undefined) =>
    v === null || v === undefined ? '–' : format.number(v);
  const tabHref = (path: string) =>
    `/app/competitors/${path}?domain=${encodeURIComponent(domain)}&loc=${loc}&lang=${lang}`;

  const keywordColumns: DataColumn<DomainKeywordRow>[] = [
    {
      id: 'keyword',
      label: t('columns.keyword'),
      header: t('columns.keyword'),
      primary: true,
      cell: (r) => (
        <Link
          href={`/app/keywords/overview?q=${encodeURIComponent(r.keyword)}&loc=${loc}&lang=${lang}`}
          className="hover:text-primary font-medium hover:underline"
        >
          {r.keyword}
        </Link>
      ),
    },
    {
      id: 'intent',
      label: t('columns.intent'),
      header: t('columns.intent'),
      cell: (r) => <IntentBadges intents={r.intent} />,
    },
    {
      id: 'position',
      label: t('columns.position'),
      header: t('columns.position'),
      align: 'right',
      cell: (r) => (
        <span className="inline-flex items-center gap-2">
          <span className="tabular">{r.position}</span>
          <PositionChange change={r.change} />
        </span>
      ),
    },
    {
      id: 'volume',
      label: t('columns.volume'),
      header: t('columns.volume'),
      metric: 'volume',
      align: 'right',
      cell: (r) => format.number(r.volume),
    },
    {
      id: 'kd',
      label: t('columns.kd'),
      header: t('columns.kd'),
      metric: 'kd',
      align: 'right',
      cell: (r) => <KdBadge kd={r.kd} />,
    },
    {
      id: 'traffic',
      label: t('columns.traffic'),
      header: t('columns.traffic'),
      metric: 'traffic',
      align: 'right',
      cell: (r) => format.number(Math.round(r.traffic)),
    },
  ];

  const pageColumns: DataColumn<TopPage>[] = [
    {
      id: 'url',
      label: t('columns.url'),
      header: t('columns.url'),
      primary: true,
      cell: (r) => <UrlCell url={r.url} />,
    },
    {
      id: 'keywords',
      label: t('columns.keywords'),
      header: t('columns.keywords'),
      align: 'right',
      cell: (r) => format.number(r.keywords),
    },
    {
      id: 'traffic',
      label: t('columns.traffic'),
      header: t('columns.traffic'),
      align: 'right',
      cell: (r) => format.number(Math.round(r.traffic)),
    },
  ];

  const history = (o?.history ?? []).map((h) => ({
    label: format.dateTime(new Date(Date.UTC(h.year, h.month - 1, 1)), {
      month: 'short',
      year: '2-digit',
    }),
    traffic: Math.round(h.estTraffic),
    keywords: h.keywords,
  }));

  return (
    <>
      <PageHeader title={o?.domain ?? t('title')} description={t('overview.description')} />
      <CompetitorsTabs />
      <DomainBar key={domain} />

      {!domain ? (
        <EmptyState icon={Globe} title={t('emptyTitle')} description={t('emptyBody')} />
      ) : overview.error ? (
        <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
      ) : !o ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric metric="traffic" label={t('overview.traffic')}>
              {n(Math.round(o.estTraffic))}
            </Metric>
            <Metric
              metric="organicKeywords"
              label={t('overview.keywords')}
              hint={t('overview.buckets', {
                top3: format.number(o.top3),
                top10: format.number(o.top10),
              })}
            >
              {n(o.organicKeywords)}
            </Metric>
            <Metric metric="domainRating" label={t('overview.rating')}>
              {n(o.rating)}
            </Metric>
            <Metric
              label={t('overview.referringDomains')}
              hint={t('overview.backlinks', { count: o.backlinks ?? 0 })}
            >
              {n(o.referringDomains)}
            </Metric>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>
                  <h2>{t('overview.history')}</h2>
                </CardTitle>
                <CardDescription>
                  {t('overview.changes', {
                    new: format.number(o.newKeywords),
                    lost: format.number(o.lostKeywords),
                  })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-56" role="img" aria-label={t('overview.history')}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={history} margin={{ left: 0, right: 8, top: 8 }}>
                      <CartesianGrid vertical={false} stroke="var(--color-border)" />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        fontSize={11}
                        stroke="var(--color-muted-foreground)"
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        fontSize={11}
                        width={48}
                        stroke="var(--color-muted-foreground)"
                        tickFormatter={(v: number) => format.number(v, { notation: 'compact' })}
                      />
                      <ChartTooltip
                        contentStyle={{
                          background: 'var(--color-popover)',
                          border: '1px solid var(--color-border)',
                          borderRadius: 6,
                          color: 'var(--color-popover-foreground)',
                        }}
                        formatter={(v, name) => [
                          format.number(Number(v)),
                          name === 'traffic' ? t('overview.traffic') : t('overview.keywords'),
                        ]}
                      />
                      <Area
                        type="monotone"
                        dataKey="traffic"
                        stroke="var(--color-primary)"
                        fill="var(--color-primary)"
                        fillOpacity={0.12}
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>{t('overview.countries')}</h2>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 text-sm">
                  {o.countries.map((c) => {
                    const iso = findLocation(c.locationCode)?.iso;
                    const share = o.estTraffic > 0 ? c.estTraffic / o.estTraffic : 0;
                    return (
                      <li key={c.locationCode} className="space-y-1">
                        <div className="flex justify-between gap-2">
                          <span>{iso ? tc(iso) : c.locationCode}</span>
                          <span className="tabular text-muted-foreground">
                            {format.number(Math.round(c.estTraffic))} ·{' '}
                            {t('overview.keywordsCount', { count: c.keywords })}
                          </span>
                        </div>
                        <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                          <div
                            className="bg-primary h-full rounded-full"
                            style={{ width: `${Math.min(100, Math.round(share * 100))}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">{t('overview.topKeywords')}</h2>
                <Button variant="link" size="sm" asChild>
                  <Link href={tabHref('keywords')}>{t('overview.viewAll')}</Link>
                </Button>
              </div>
              <DataTable
                columns={keywordColumns}
                rows={o.topKeywords}
                rowId={(r) => r.keyword}
                caption={t('overview.topKeywords')}
                storageKey="domain-top-keywords"
              />
            </section>
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">{t('overview.topPages')}</h2>
                <Button variant="link" size="sm" asChild>
                  <Link href={tabHref('pages')}>{t('overview.viewAll')}</Link>
                </Button>
              </div>
              <DataTable
                columns={pageColumns}
                rows={o.topPages}
                rowId={(r) => r.url}
                caption={t('overview.topPages')}
                storageKey="domain-top-pages"
              />
            </section>
          </div>

          <p className="text-muted-foreground text-xs">
            {t('dataFrom', {
              date: format.dateTime(new Date(o.fetchedAt), { dateStyle: 'medium' }),
            })}
            {o.creditsCharged > 0 && ` · ${t('creditsSpent', { count: o.creditsCharged })}`}
          </p>
        </div>
      )}
    </>
  );
}
