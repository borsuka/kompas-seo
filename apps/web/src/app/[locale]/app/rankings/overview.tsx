'use client';
import { LineChart as LineChartIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { RankingsSummary } from '@seo/shared';
import { Button } from '@seo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@seo/ui/card';
import { Skeleton } from '@seo/ui/skeleton';
import { Segmented } from '@/components/competitors/segmented';
import { MetricLabel, type MetricKey } from '@/components/metric-tooltip';
import { PageHeader } from '@/components/page-header';
import { CheckNow } from '@/components/rankings/check-now';
import { Change, Position } from '@/components/rankings/rank-badges';
import { RankingsTabs } from '@/components/rankings/rankings-tabs';
import { NoProject, useRankProject } from '@/components/rankings/use-rank-project';
import { EmptyState, ErrorState } from '@/components/states';
import { Link } from '@/i18n/navigation';
import { useRankingsSummary } from '@/lib/rankings-api';
import { useSearchState } from '@/lib/use-search-state';

const tooltipStyle = {
  background: 'var(--color-popover)',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  color: 'var(--color-popover-foreground)',
};
const SOV_COLORS = ['var(--color-primary)', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#64748b'];

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
        {hint && <div className="text-muted-foreground text-xs">{hint}</div>}
      </CardHeader>
    </Card>
  );
}

function Movers({ title, rows }: { title: string; rows: RankingsSummary['movers']['up'] }) {
  const t = useTranslations('rankings');
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('overview.noMovers')}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {rows.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {m.keyword}
                  {m.device === 'mobile' && (
                    <span className="text-muted-foreground ml-1 text-xs">
                      {t('devices.mobile')}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Position value={m.position} />
                  <Change value={m.change} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function RankingsOverview() {
  const t = useTranslations('rankings');
  const format = useFormatter();
  const project = useRankProject();
  const { params, set } = useSearchState();
  const days = params.days ?? '30';
  const device = (params.device ?? 'all') as 'all' | 'desktop' | 'mobile';
  const summary = useRankingsSummary(project?.id, {
    days,
    device: device === 'all' ? undefined : device,
    tag: params.tag,
  });
  const s = summary.data;

  if (!project) return <NoProject />;

  const dateLabel = (d: string) =>
    format.dateTime(new Date(`${d}T00:00:00Z`), { day: 'numeric', month: 'short' });
  const trend = (s?.trend ?? []).map((p) => ({ ...p, label: dateLabel(p.date) }));
  const domains = (s?.shareOfVoice ?? []).map((x) => x.domain);
  const sovTrend = (s?.sovTrend ?? []).map((p) => ({
    label: dateLabel(p.date),
    ...Object.fromEntries(Object.entries(p.shares).map(([d, v]) => [d, Math.round(v * 1000) / 10])),
  }));
  const dist = s?.distribution;
  const distData = dist
    ? [
        { label: t('overview.buckets.top3'), value: dist.top3 },
        { label: t('overview.buckets.p4_10'), value: dist.top10 - dist.top3 },
        { label: t('overview.buckets.p11_20'), value: dist.top20 - dist.top10 },
        { label: t('overview.buckets.p21_50'), value: dist.top50 - dist.top20 },
        { label: t('overview.buckets.p51_100'), value: dist.top100 - dist.top50 },
        { label: t('overview.buckets.notRanked'), value: dist.notRanked },
      ]
    : [];

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('overview.description', { domain: project.domain })}
        actions={
          s && (
            <CheckNow
              projectId={project.id}
              lastCheckedAt={s.lastCheckedAt}
              keywords={s.keywords}
            />
          )
        }
      />
      <RankingsTabs />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label={t('overview.period')}
          value={days}
          onChange={(v) => set({ days: v === '30' ? null : v })}
          options={['7', '30', '90', '365'].map((v) => ({
            value: v,
            label: t('overview.days', { count: Number(v) }),
          }))}
        />
        <Segmented
          label={t('device')}
          value={device}
          onChange={(v) => set({ device: v === 'all' ? null : v })}
          options={(['all', 'desktop', 'mobile'] as const).map((v) => ({
            value: v,
            label: t(`devices.${v}`),
          }))}
        />
      </div>

      {summary.error ? (
        <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
      ) : !s ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : s.keywords === 0 ? (
        <EmptyState
          icon={LineChartIcon}
          title={t('emptyTitle')}
          description={t('emptyBody')}
          action={
            <Button asChild>
              <Link href="/app/rankings/keywords?add=1">{t('addKeywords')}</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              metric="visibility"
              label={t('overview.visibility')}
              hint={
                s.visibilityChange !== null && (
                  <span
                    className={
                      s.visibilityChange > 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : s.visibilityChange < 0
                          ? 'text-red-600 dark:text-red-400'
                          : undefined
                    }
                  >
                    {t('overview.visibilityChange', {
                      change: format.number(s.visibilityChange, {
                        signDisplay: 'exceptZero',
                        maximumFractionDigits: 2,
                      }),
                    })}
                  </span>
                )
              }
            >
              {format.number(s.visibility / 100, { style: 'percent', maximumFractionDigits: 1 })}
            </Metric>
            <Metric metric="avgPosition" label={t('overview.avgPosition')}>
              {s.avgPosition === null
                ? '–'
                : format.number(s.avgPosition, { maximumFractionDigits: 1 })}
            </Metric>
            <Metric
              label={t('overview.ranked')}
              hint={t('overview.rankedOf', { count: s.keywords })}
            >
              {format.number(s.ranked)}
            </Metric>
            <Metric label={t('overview.changes')} hint={t('overview.changesHint')}>
              <span className="flex items-baseline gap-3">
                <span className="text-emerald-600 dark:text-emerald-400">↑ {s.improved}</span>
                <span className="text-red-600 dark:text-red-400">↓ {s.declined}</span>
              </span>
            </Metric>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>
                  <h2>{t('overview.visibilityTrend')}</h2>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {trend.length < 2 ? (
                  <p className="text-muted-foreground text-sm">{t('overview.needMoreChecks')}</p>
                ) : (
                  <div className="h-56" role="img" aria-label={t('overview.visibilityTrend')}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trend} margin={{ left: 0, right: 8, top: 8 }}>
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
                          width={40}
                          stroke="var(--color-muted-foreground)"
                          tickFormatter={(v: number) => `${v}%`}
                        />
                        <ChartTooltip
                          contentStyle={tooltipStyle}
                          formatter={(v) => [
                            `${format.number(Number(v))}%`,
                            t('overview.visibility'),
                          ]}
                        />
                        <Area
                          type="monotone"
                          dataKey="visibility"
                          stroke="var(--color-primary)"
                          fill="var(--color-primary)"
                          fillOpacity={0.12}
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>{t('overview.distribution')}</h2>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-56" role="img" aria-label={t('overview.distribution')}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={distData} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <XAxis type="number" hide allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="label"
                        width={88}
                        tickLine={false}
                        axisLine={false}
                        fontSize={11}
                        stroke="var(--color-muted-foreground)"
                      />
                      <ChartTooltip
                        contentStyle={tooltipStyle}
                        cursor={{ fill: 'var(--color-muted)' }}
                        formatter={(v) => [format.number(Number(v)), t('overview.keywords')]}
                      />
                      <Bar dataKey="value" fill="var(--color-primary)" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>
                  <h2>
                    <MetricLabel metric="shareOfVoice" label={t('overview.shareOfVoice')} />
                  </h2>
                </CardTitle>
                <CardDescription>{t('overview.shareOfVoiceHint')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2 text-sm">
                  {s.shareOfVoice.map((x, i) => (
                    <li key={x.domain} className="space-y-1">
                      <div className="flex justify-between gap-2">
                        <span className={x.isProject ? 'font-semibold' : undefined}>
                          <span
                            className="mr-2 inline-block size-2 rounded-full"
                            style={{ background: SOV_COLORS[i % SOV_COLORS.length] }}
                            aria-hidden
                          />
                          {x.domain}
                        </span>
                        <span className="tabular">
                          {format.number(x.share, { style: 'percent', maximumFractionDigits: 1 })}
                        </span>
                      </div>
                      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.round(x.share * 100)}%`,
                            background: SOV_COLORS[i % SOV_COLORS.length],
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
                {sovTrend.length > 1 && domains.length > 1 && (
                  <div className="h-40" role="img" aria-label={t('overview.shareOfVoice')}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={sovTrend}
                        margin={{ left: 0, right: 8, top: 8 }}
                        stackOffset="expand"
                      >
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          fontSize={11}
                          stroke="var(--color-muted-foreground)"
                        />
                        <YAxis hide />
                        <ChartTooltip
                          contentStyle={tooltipStyle}
                          formatter={(v, name) => [`${format.number(Number(v))}%`, String(name)]}
                        />
                        {domains.map((d, i) => (
                          <Area
                            key={d}
                            type="monotone"
                            dataKey={d}
                            stackId="sov"
                            stroke={SOV_COLORS[i % SOV_COLORS.length]}
                            fill={SOV_COLORS[i % SOV_COLORS.length]}
                            fillOpacity={0.5}
                          />
                        ))}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>
                    <MetricLabel metric="volatility" label={t('overview.volatility')} />
                  </h2>
                </CardTitle>
                <CardDescription>
                  {trend.length
                    ? t('overview.volatilityToday', {
                        value: format.number(trend.at(-1)!.volatility, {
                          maximumFractionDigits: 1,
                        }),
                      })
                    : '–'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {trend.length < 2 ? (
                  <p className="text-muted-foreground text-sm">{t('overview.needMoreChecks')}</p>
                ) : (
                  <div className="h-40" role="img" aria-label={t('overview.volatility')}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={trend} margin={{ left: 0, right: 8, top: 8 }}>
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          fontSize={11}
                          stroke="var(--color-muted-foreground)"
                        />
                        <YAxis domain={[0, 10]} hide />
                        <ChartTooltip
                          contentStyle={tooltipStyle}
                          cursor={{ fill: 'var(--color-muted)' }}
                          formatter={(v) => [format.number(Number(v)), t('overview.volatility')]}
                        />
                        <Bar dataKey="volatility" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Movers title={t('overview.moversUp')} rows={s.movers.up} />
            <Movers title={t('overview.moversDown')} rows={s.movers.down} />
          </div>
        </div>
      )}
    </>
  );
}
