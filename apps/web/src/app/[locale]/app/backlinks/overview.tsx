'use client';
import { Link2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ANCHOR_TYPES, LINK_RELS, type AnchorRowDto, type ReferringDomain } from '@seo/shared';
import { Button } from '@seo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@seo/ui/card';
import { Skeleton } from '@seo/ui/skeleton';
import { BacklinksTabs } from '@/components/backlinks/backlinks-tabs';
import { Rating } from '@/components/backlinks/badges';
import { DomainBar, useDomainParams } from '@/components/competitors/domain-bar';
import { DataTable, type DataColumn } from '@/components/data-table';
import { MetricLabel, type MetricKey } from '@/components/metric-tooltip';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState } from '@/components/states';
import { Link } from '@/i18n/navigation';
import { useBacklinkOverview } from '@/lib/backlinks-api';

const tooltipStyle = {
  background: 'var(--color-popover)',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  color: 'var(--color-popover-foreground)',
};
const TYPE_COLORS: Record<string, string> = {
  branded: 'var(--color-primary)',
  url: '#0ea5e9',
  generic: '#a3a3a3',
  empty: '#d4d4d4',
  other: '#f59e0b',
};

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

/** Horizontal share bars (anchor types, rel attributes, TLDs). */
function Shares({
  rows,
}: {
  rows: { key: string; label: string; value: number; color?: string }[];
}) {
  const format = useFormatter();
  const total = rows.reduce((s, r) => s + r.value, 0) || 1;
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((r) => (
        <li key={r.key} className="space-y-1">
          <div className="flex justify-between gap-2">
            <span>{r.label}</span>
            <span className="tabular text-muted-foreground">
              {format.number(r.value)} · {format.number(r.value / total, { style: 'percent' })}
            </span>
          </div>
          <div className="bg-muted h-1.5 overflow-hidden rounded-full">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(r.value / total) * 100}%`,
                background: r.color ?? 'var(--color-primary)',
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function BacklinksOverview() {
  const t = useTranslations('backlinks');
  const format = useFormatter();
  const { domain } = useDomainParams();
  const overview = useBacklinkOverview({ target: domain || undefined });
  const o = overview.data;
  const tab = (path: string) => `/app/backlinks/${path}?domain=${encodeURIComponent(domain)}`;

  const anchorColumns: DataColumn<AnchorRowDto>[] = [
    {
      id: 'anchor',
      label: t('columns.anchor'),
      header: t('columns.anchor'),
      primary: true,
      cell: (r) => <span className="font-medium">{r.anchor || t('anchors.empty')}</span>,
    },
    {
      id: 'type',
      label: t('columns.type'),
      header: t('columns.type'),
      cell: (r) => t(`anchorTypes.${r.type}`),
    },
    {
      id: 'domains',
      label: t('columns.referringDomains'),
      header: t('columns.referringDomains'),
      align: 'right',
      cell: (r) => format.number(r.referringDomains),
    },
  ];
  const domainColumns: DataColumn<ReferringDomain>[] = [
    {
      id: 'domain',
      label: t('columns.domain'),
      header: t('columns.domain'),
      primary: true,
      cell: (r) => <span className="font-medium">{r.domain}</span>,
    },
    {
      id: 'rating',
      label: t('columns.rating'),
      header: t('columns.rating'),
      metric: 'domainRating',
      align: 'right',
      cell: (r) => <Rating value={r.rating} />,
    },
    {
      id: 'backlinks',
      label: t('columns.backlinks'),
      header: t('columns.backlinks'),
      align: 'right',
      cell: (r) => format.number(r.backlinks),
    },
  ];

  const monthLabel = (m: string) =>
    format.dateTime(new Date(`${m}-01T00:00:00Z`), { month: 'short', year: '2-digit' });
  const newLost = (o?.newLost ?? []).map((m) => ({
    label: monthLabel(m.month),
    new: m.new,
    lost: -m.lost,
  }));
  const s = o?.summary;

  return (
    <>
      <PageHeader title={o?.target ?? t('title')} description={t('overview.description')} />
      <BacklinksTabs />
      <DomainBar key={domain} showLocale={false} />

      {!domain ? (
        <EmptyState icon={Link2} title={t('emptyTitle')} description={t('emptyBody')} />
      ) : overview.error ? (
        <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
      ) : !o || !s ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric metric="domainRating" label={t('overview.rating')}>
              {format.number(s.rating)}
            </Metric>
            <Metric
              label={t('overview.referringDomains')}
              hint={t('overview.referringIps', { count: s.referringIps ?? 0 })}
            >
              {format.number(s.referringDomains)}
            </Metric>
            <Metric
              label={t('overview.backlinks')}
              hint={t('overview.dofollowShare', {
                share: format.number(s.backlinks ? s.dofollow / s.backlinks : 0, {
                  style: 'percent',
                }),
              })}
            >
              {format.number(s.backlinks)}
            </Metric>
            <Metric label={t('overview.broken')} hint={t('overview.brokenHint')}>
              {format.number(s.brokenBacklinks)}
            </Metric>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>
                  <h2>{t('overview.newLost')}</h2>
                </CardTitle>
                <CardDescription>{t('overview.newLostHint')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-56" role="img" aria-label={t('overview.newLost')}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={newLost}
                      stackOffset="sign"
                      margin={{ left: 0, right: 8, top: 8 }}
                    >
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
                        tickFormatter={(v: number) =>
                          format.number(Math.abs(v), { notation: 'compact' })
                        }
                      />
                      <ChartTooltip
                        contentStyle={tooltipStyle}
                        cursor={{ fill: 'var(--color-muted)' }}
                        formatter={(v, name) => [
                          format.number(Math.abs(Number(v))),
                          name === 'new' ? t('overview.new') : t('overview.lost'),
                        ]}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 12 }}
                        formatter={(v) => (v === 'new' ? t('overview.new') : t('overview.lost'))}
                      />
                      <Bar dataKey="new" stackId="a" fill="#10b981" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="lost" stackId="a" fill="#ef4444" radius={[0, 0, 3, 3]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>{t('overview.anchorTypes')}</h2>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Shares
                  rows={ANCHOR_TYPES.map((k) => ({
                    key: k,
                    label: t(`anchorTypes.${k}`),
                    value: o.anchorTypes[k] ?? 0,
                    color: TYPE_COLORS[k],
                  })).filter((r) => r.value > 0)}
                />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">{t('overview.topAnchors')}</h2>
                <Button variant="link" size="sm" asChild>
                  <Link href={tab('anchors')}>{t('overview.viewAll')}</Link>
                </Button>
              </div>
              <DataTable
                columns={anchorColumns}
                rows={o.anchors}
                rowId={(r) => r.anchor}
                caption={t('overview.topAnchors')}
                storageKey="bl-top-anchors"
              />
            </section>
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">{t('overview.topDomains')}</h2>
                <Button variant="link" size="sm" asChild>
                  <Link href={tab('domains')}>{t('overview.viewAll')}</Link>
                </Button>
              </div>
              <DataTable
                columns={domainColumns}
                rows={o.topReferringDomains}
                rowId={(r) => r.domain}
                caption={t('overview.topDomains')}
                storageKey="bl-top-domains"
              />
            </section>
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <h2>{t('overview.rel')}</h2>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Shares
                    rows={LINK_RELS.map((k) => ({
                      key: k,
                      label: t(`rel.${k}`),
                      value: o.rel[k] ?? 0,
                    })).filter((r) => r.value > 0)}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>
                    <h2>{t('overview.tlds')}</h2>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Shares
                    rows={o.tlds.map((x) => ({
                      key: x.tld,
                      label: `.${x.tld}`,
                      value: x.domains,
                      color: '#64748b',
                    }))}
                  />
                </CardContent>
              </Card>
            </div>
          </div>

          <p className="text-muted-foreground text-xs">
            {t('sample', {
              backlinks: format.number(o.sample.backlinks),
              domains: format.number(o.sample.referringDomains),
              date: format.dateTime(new Date(o.fetchedAt), { dateStyle: 'medium' }),
            })}
            {o.creditsCharged > 0 && ` · ${t('creditsSpent', { count: o.creditsCharged })}`}
          </p>
        </div>
      )}
    </>
  );
}
