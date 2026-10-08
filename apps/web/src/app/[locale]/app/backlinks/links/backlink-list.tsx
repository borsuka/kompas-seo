'use client';
import { Link2, Search, SearchX } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { LINK_RELS, type Backlink } from '@seo/shared';
import { Input } from '@seo/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@seo/ui/select';
import { BacklinksTabs } from '@/components/backlinks/backlinks-tabs';
import { Rating, RelBadge } from '@/components/backlinks/badges';
import { DomainBar, useDomainParams } from '@/components/competitors/domain-bar';
import { UrlCell } from '@/components/competitors/position';
import { Segmented } from '@/components/competitors/segmented';
import { DataTable, Pagination, type DataColumn } from '@/components/data-table';
import { ExportMenu } from '@/components/keywords/export-menu';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState } from '@/components/states';
import { useBacklinkList } from '@/lib/backlinks-api';

const ALL = '__all__';
const STATUSES = ['live', 'new', 'lost', 'broken', 'all'] as const;

export function BacklinkListView() {
  const t = useTranslations('backlinks');
  const format = useFormatter();
  const { domain, params, set } = useDomainParams();
  const [search, setSearch] = useState(params.q ?? '');
  const status = (params.status ?? 'live') as (typeof STATUSES)[number];
  const query = {
    target: domain || undefined,
    status,
    rel: params.rel,
    q: params.q,
    sort: params.sort ?? 'rating',
    dir: params.dir ?? 'desc',
    page: params.page ?? '1',
    pageSize: params.pageSize ?? '50',
  };
  const list = useBacklinkList(query);
  const data = list.data;
  const date = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: 'medium' }) : '–';
  const onSort = (field: string) =>
    set({ sort: field, dir: query.sort === field && query.dir === 'desc' ? 'asc' : 'desc' });

  const columns: DataColumn<Backlink>[] = [
    {
      id: 'source',
      label: t('columns.source'),
      header: t('columns.source'),
      primary: true,
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{r.sourceDomain}</span>
          <UrlCell url={r.sourceUrl} />
        </span>
      ),
    },
    {
      id: 'anchor',
      label: t('columns.anchor'),
      header: t('columns.anchor'),
      cell: (r) => (
        <span className="flex max-w-xs flex-col gap-1">
          <span className="truncate">
            {r.anchor || <span className="text-muted-foreground">{t('anchors.empty')}</span>}
          </span>
          <RelBadge rel={r.rel} />
        </span>
      ),
    },
    {
      id: 'target',
      label: t('columns.target'),
      header: t('columns.target'),
      hideable: true,
      cell: (r) => (
        <span className="flex items-center gap-1.5">
          <UrlCell url={r.targetUrl} />
          {r.targetStatus !== null && r.targetStatus >= 400 && (
            <span className="rounded bg-red-500/15 px-1 text-[11px] font-semibold text-red-700 dark:text-red-300">
              {r.targetStatus}
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'rating',
      label: t('columns.rating'),
      header: t('columns.rating'),
      metric: 'domainRating',
      sortKey: 'rating',
      align: 'right',
      cell: (r) => <Rating value={r.sourceRating} />,
    },
    {
      id: 'spam',
      label: t('columns.spam'),
      header: t('columns.spam'),
      metric: 'spamScore',
      sortKey: 'spamScore',
      align: 'right',
      hideable: true,
      cell: (r) => (r.spamScore === null ? '–' : r.spamScore),
    },
    {
      id: 'firstSeen',
      label: t('columns.firstSeen'),
      header: t('columns.firstSeen'),
      sortKey: 'firstSeen',
      align: 'right',
      hideable: true,
      cell: (r) => date(r.firstSeen),
    },
    {
      id: 'lastSeen',
      label: t('columns.lastSeen'),
      header: t('columns.lastSeen'),
      sortKey: 'lastSeen',
      align: 'right',
      hideable: true,
      cell: (r) =>
        r.lostAt ? (
          <span className="text-red-600 dark:text-red-400">
            {t('lostOn', { date: date(r.lostAt) })}
          </span>
        ) : (
          date(r.lastSeen)
        ),
    },
  ];

  const total = data?.total ?? 0;
  return (
    <>
      <PageHeader title={domain || t('title')} description={t('links.description')} />
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
            <div className="flex gap-2">
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
                  placeholder={t('links.search')}
                  aria-label={t('links.search')}
                  className="w-56 pl-9"
                />
              </form>
              <Select
                value={params.rel ?? ALL}
                onValueChange={(v) => set({ rel: v === ALL ? null : v })}
              >
                <SelectTrigger className="w-36" aria-label={t('columns.rel')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('links.allRel')}</SelectItem>
                  {LINK_RELS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`rel.${r}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            rowId={(r) => `${r.sourceUrl}|${r.targetUrl}|${r.anchor}`}
            caption={t('links.results', { count: total })}
            loading={list.isFetching}
            storageKey="backlinks-list"
            sort={{ field: query.sort, dir: query.dir as 'asc' | 'desc' }}
            onSort={onSort}
            empty={<EmptyState icon={SearchX} title={t('noResults')} />}
            toolbar={
              <>
                <span className="text-muted-foreground tabular text-sm">
                  {t('links.results', { count: total })}
                </span>
                <ExportMenu path="/backlinks/list/export" params={query} />
              </>
            }
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">
              {data && data.creditsCharged > 0 && t('creditsSpent', { count: data.creditsCharged })}
            </p>
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
