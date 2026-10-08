'use client';
import { Link2, Search, SearchX } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ReferringDomain, ToxicityDto } from '@seo/shared';
import { Input } from '@seo/ui/input';
import { BacklinksTabs } from '@/components/backlinks/backlinks-tabs';
import { Rating, ToxicityBadge } from '@/components/backlinks/badges';
import { DomainBar, useDomainParams } from '@/components/competitors/domain-bar';
import { Segmented } from '@/components/competitors/segmented';
import { DataTable, Pagination, type DataColumn } from '@/components/data-table';
import { ExportMenu } from '@/components/keywords/export-menu';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState } from '@/components/states';
import { Link } from '@/i18n/navigation';
import { useReferringDomains } from '@/lib/backlinks-api';

type Row = ReferringDomain & { toxicity: ToxicityDto };
const STATUSES = ['live', 'new', 'lost', 'all'] as const;

export function ReferringDomainsView() {
  const t = useTranslations('backlinks');
  const format = useFormatter();
  const { domain, params, set } = useDomainParams();
  const [search, setSearch] = useState(params.q ?? '');
  const status = (params.status ?? 'live') as (typeof STATUSES)[number];
  const query = {
    target: domain || undefined,
    status,
    q: params.q,
    sort: params.sort ?? 'rating',
    dir: params.dir ?? 'desc',
    page: params.page ?? '1',
    pageSize: params.pageSize ?? '50',
  };
  const list = useReferringDomains(query);
  const data = list.data;
  const date = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: 'medium' }) : '–';
  const onSort = (field: string) =>
    set({ sort: field, dir: query.sort === field && query.dir === 'desc' ? 'asc' : 'desc' });

  const columns: DataColumn<Row>[] = [
    {
      id: 'domain',
      label: t('columns.domain'),
      header: t('columns.domain'),
      primary: true,
      cell: (r) => (
        <Link
          href={`/app/backlinks?domain=${encodeURIComponent(r.domain)}`}
          className="hover:text-primary font-medium hover:underline"
        >
          {r.domain}
        </Link>
      ),
    },
    {
      id: 'rating',
      label: t('columns.rating'),
      header: t('columns.rating'),
      metric: 'domainRating',
      sortKey: 'rating',
      align: 'right',
      cell: (r) => <Rating value={r.rating} />,
    },
    {
      id: 'backlinks',
      label: t('columns.backlinks'),
      header: t('columns.backlinks'),
      sortKey: 'backlinks',
      align: 'right',
      cell: (r) => format.number(r.backlinks),
    },
    {
      id: 'dofollow',
      label: t('columns.dofollow'),
      header: t('columns.dofollow'),
      align: 'right',
      hideable: true,
      cell: (r) => format.number(r.dofollow),
    },
    {
      id: 'toxicity',
      label: t('columns.toxicity'),
      header: t('columns.toxicity'),
      metric: 'toxicity',
      sortKey: 'spamScore',
      align: 'right',
      hideable: true,
      cell: (r) => <ToxicityBadge value={r.toxicity} />,
    },
    {
      id: 'firstSeen',
      label: t('columns.firstSeen'),
      header: t('columns.firstSeen'),
      sortKey: 'firstSeen',
      align: 'right',
      hideable: true,
      cell: (r) =>
        r.lostAt ? (
          <span className="text-red-600 dark:text-red-400">
            {t('lostOn', { date: date(r.lostAt) })}
          </span>
        ) : (
          date(r.firstSeen)
        ),
    },
  ];

  const total = data?.total ?? 0;
  return (
    <>
      <PageHeader title={domain || t('title')} description={t('domains.description')} />
      <BacklinksTabs />
      <DomainBar key={domain} showLocale={false} />
      {!domain ? (
        <EmptyState icon={Link2} title={t('emptyTitle')} description={t('emptyBody')} />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <Segmented
              label={t('links.status')}
              value={status}
              onChange={(v) => set({ status: v === 'live' ? null : v })}
              options={STATUSES.map((v) => ({ value: v, label: t(`links.statuses.${v}`) }))}
            />
            <form
              className="relative"
              onSubmit={(e) => {
                e.preventDefault();
                set({ q: search.trim() || null });
              }}
            >
              <Search
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('domains.search')}
                aria-label={t('domains.search')}
                className="w-56 pl-9"
              />
            </form>
          </div>
          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            rowId={(r) => r.domain}
            caption={t('domains.results', { count: total })}
            loading={list.isFetching}
            storageKey="referring-domains"
            sort={{ field: query.sort, dir: query.dir as 'asc' | 'desc' }}
            onSort={onSort}
            empty={<EmptyState icon={SearchX} title={t('noResults')} />}
            toolbar={
              <>
                <span className="text-muted-foreground tabular text-sm">
                  {t('domains.results', { count: total })}
                </span>
                <ExportMenu path="/backlinks/referring-domains/export" params={query} />
              </>
            }
          />
          <div className="flex justify-end">
            <Pagination
              page={Number(query.page)}
              pageSize={Number(query.pageSize)}
              total={total}
              onPage={(p) => set({ page: p })}
              onPageSize={(s) => set({ pageSize: s })}
            />
          </div>
        </div>
      )}
    </>
  );
}
