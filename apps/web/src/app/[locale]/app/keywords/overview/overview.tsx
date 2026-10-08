'use client';
import { ArrowLeft, ExternalLink, Search } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SerpResult } from '@seo/shared';
import { Badge } from '@seo/ui/badge';
import { Button } from '@seo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@seo/ui/card';
import { Skeleton } from '@seo/ui/skeleton';
import { useCurrentProject } from '@/components/app-shell/project-context';
import { DataTable, type DataColumn } from '@/components/data-table';
import { AddToListDialog } from '@/components/keywords/add-to-list-dialog';
import { IntentBadges, KdBadge } from '@/components/keywords/badges';
import { KeywordsTabs } from '@/components/keywords/keywords-tabs';
import { MetricLabel, type MetricKey } from '@/components/metric-tooltip';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState } from '@/components/states';
import { Link } from '@/i18n/navigation';
import { useOverview } from '@/lib/keywords-api';
import { useCan } from '@/lib/queries';
import { useSearchState } from '@/lib/use-search-state';

function Metric({
  metric,
  label,
  children,
}: {
  metric?: MetricKey;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>
          {metric ? <MetricLabel metric={metric} label={label} /> : label}
        </CardDescription>
        <CardTitle className="tabular text-2xl">{children}</CardTitle>
      </CardHeader>
    </Card>
  );
}

export function KeywordOverviewView() {
  const t = useTranslations('keywords');
  const format = useFormatter();
  const can = useCan();
  const { current } = useCurrentProject();
  const { params } = useSearchState();
  const loc = Number(params.loc ?? current?.locationCode ?? 2100);
  const lang = params.lang ?? current?.languageCode ?? 'bg';
  const overview = useOverview({
    q: params.q,
    loc: String(loc),
    lang,
    device: params.device ?? 'desktop',
  });
  const o = overview.data;

  const columns: DataColumn<SerpResult>[] = [
    {
      id: 'position',
      label: t('overview.position'),
      header: t('overview.position'),
      align: 'right',
      cell: (r) => r.position,
    },
    {
      id: 'url',
      label: t('overview.url'),
      header: t('overview.url'),
      primary: true,
      cell: (r) => (
        <a
          href={r.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="group block max-w-md"
        >
          <span className="block truncate font-medium group-hover:underline">
            {r.title ?? r.domain}
          </span>
          <span className="text-muted-foreground flex items-center gap-1 truncate text-xs">
            {r.url} <ExternalLink className="size-3 shrink-0" aria-hidden />
          </span>
        </a>
      ),
    },
    {
      id: 'dr',
      label: t('overview.dr'),
      header: t('overview.dr'),
      align: 'right',
      hideable: true,
      cell: (r) => r.domainRating ?? '–',
    },
    {
      id: 'rd',
      label: t('overview.refDomains'),
      header: t('overview.refDomains'),
      align: 'right',
      hideable: true,
      cell: (r) => (r.referringDomains === null ? '–' : format.number(r.referringDomains)),
    },
    {
      id: 'bl',
      label: t('overview.backlinks'),
      header: t('overview.backlinks'),
      align: 'right',
      hideable: true,
      defaultHidden: true,
      cell: (r) => (r.backlinks === null ? '–' : format.number(r.backlinks)),
    },
    {
      id: 'traffic',
      label: t('overview.traffic'),
      header: <MetricLabel metric="traffic" label={t('overview.traffic')} />,
      align: 'right',
      cell: (r) => format.number(r.estTraffic),
    },
  ];

  if (!params.q) {
    return (
      <>
        <PageHeader title={t('overview.title')} />
        <KeywordsTabs />
        <EmptyState
          icon={Search}
          title={t('emptyTitle')}
          action={
            <Button asChild>
              <Link href="/app/keywords">{t('tabs.explorer')}</Link>
            </Button>
          }
        />
      </>
    );
  }

  const trend = (o?.metrics.trend ?? []).map((m) => ({
    label: format.dateTime(new Date(Date.UTC(m.year, m.month - 1, 1)), {
      month: 'short',
      year: '2-digit',
    }),
    volume: m.volume,
  }));

  return (
    <>
      <PageHeader
        title={params.q}
        description={t('overview.title')}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link
                href={`/app/keywords?q=${encodeURIComponent(params.q)}&loc=${loc}&lang=${lang}`}
              >
                <ArrowLeft aria-hidden /> {t('overview.backToIdeas')}
              </Link>
            </Button>
            {can('keywordList:update') && (
              <AddToListDialog keywords={[params.q]} locationCode={loc} languageCode={lang} />
            )}
          </>
        }
      />
      <KeywordsTabs />

      {overview.error ? (
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
            <Metric metric="volume" label={t('overview.volume')}>
              {format.number(o.metrics.volume)}
            </Metric>
            <Metric metric="kd" label={t('overview.kd')}>
              <span
                title={
                  o.kdSource === 'computed' ? t('overview.kdComputed') : t('overview.kdProvider')
                }
              >
                <KdBadge kd={o.kd} />
              </span>
            </Metric>
            <Metric metric="cpc" label={t('overview.cpc')}>
              {o.metrics.cpc === null
                ? '–'
                : format.number(o.metrics.cpc, { style: 'currency', currency: 'USD' })}
            </Metric>
            <Metric metric="competition" label={t('overview.competition')}>
              {o.metrics.competition === null
                ? '–'
                : format.number(o.metrics.competition, { maximumFractionDigits: 2 })}
            </Metric>
            <Metric metric="intent" label={t('overview.intent')}>
              <span className="flex flex-wrap gap-1 text-sm font-normal">
                <IntentBadges intents={o.metrics.intent} />
                {o.metrics.intent.map((i) => t(`intents.${i}`)).join(', ')}
              </span>
            </Metric>
            <Metric metric="trafficPotential" label={t('overview.trafficPotential')}>
              {o.trafficPotential === null ? '–' : format.number(o.trafficPotential)}
            </Metric>
            <Metric metric="parentTopic" label={t('overview.parentTopic')}>
              {o.parentTopic ? (
                <Link
                  href={`/app/keywords/overview?q=${encodeURIComponent(o.parentTopic)}&loc=${loc}&lang=${lang}`}
                  className="text-primary text-base font-medium hover:underline"
                >
                  {o.parentTopic}
                </Link>
              ) : (
                '–'
              )}
            </Metric>
            <Metric label={t('overview.serpFeatures')}>
              <span className="flex flex-wrap gap-1">
                {o.serp.features.length ? (
                  o.serp.features.map((f) => (
                    <Badge key={f} variant="outline">
                      {t(`features.${f}`)}
                    </Badge>
                  ))
                ) : (
                  <span className="text-muted-foreground text-sm font-normal">
                    {t('overview.noFeatures')}
                  </span>
                )}
              </span>
            </Metric>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>{t('overview.trend')}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {trend.length ? (
                <div className="h-56" role="img" aria-label={t('overview.trend')}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trend} margin={{ left: 0, right: 8, top: 8 }}>
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
                        cursor={{ fill: 'var(--color-muted)' }}
                        contentStyle={{
                          background: 'var(--color-popover)',
                          border: '1px solid var(--color-border)',
                          borderRadius: 6,
                          color: 'var(--color-popover-foreground)',
                        }}
                        formatter={(v) => [format.number(Number(v)), t('overview.volume')]}
                      />
                      <Bar dataKey="volume" fill="var(--color-primary)" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">{t('overview.noTrend')}</p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-2 lg:col-span-2">
              <h2 className="text-base font-semibold">{t('overview.serpTitle')}</h2>
              <DataTable
                columns={columns}
                rows={o.serp.results}
                rowId={(r) => r.url}
                caption={t('overview.serpTitle')}
                storageKey="overview-serp"
                toolbar={
                  <span className="text-muted-foreground text-xs">
                    {t('overview.checkedAt', {
                      date: format.dateTime(new Date(o.serp.checkedAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                    })}
                    {o.creditsCharged > 0 && ` · ${t('creditsSpent', { count: o.creditsCharged })}`}
                  </span>
                }
              />
            </div>
            <div className="space-y-4">
              {o.serp.peopleAlsoAsk.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <h2>{t('overview.paa')}</h2>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm">
                      {o.serp.peopleAlsoAsk.map((q) => (
                        <li key={q}>
                          <Link
                            href={`/app/keywords/overview?q=${encodeURIComponent(q)}&loc=${loc}&lang=${lang}`}
                            className="hover:text-primary hover:underline"
                          >
                            {q}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
              {o.serp.aiOverviewReferences.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <h2>{t('overview.aiOverview')}</h2>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1 text-sm">
                      {o.serp.aiOverviewReferences.map((u) => (
                        <li key={u} className="truncate">
                          <a
                            href={u}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="text-muted-foreground hover:underline"
                          >
                            {u}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
