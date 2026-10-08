'use client';
import { Globe, SearchX } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { DomainKeywordRow } from '@seo/shared';
import { Button } from '@seo/ui/button';
import { CompetitorsTabs } from '@/components/competitors/competitors-tabs';
import { DomainBar, useDomainParams } from '@/components/competitors/domain-bar';
import { PositionChange, UrlCell } from '@/components/competitors/position';
import { Segmented } from '@/components/competitors/segmented';
import { DataTable, Pagination, type DataColumn } from '@/components/data-table';
import { AddToListDialog } from '@/components/keywords/add-to-list-dialog';
import { FeatureList, IntentBadges, KdBadge } from '@/components/keywords/badges';
import { ExportMenu } from '@/components/keywords/export-menu';
import { FilterBar, FILTER_KEYS } from '@/components/keywords/filter-bar';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState } from '@/components/states';
import { Link } from '@/i18n/navigation';
import { useDomainKeywords } from '@/lib/domains-api';
import { useCan } from '@/lib/queries';

const POSITION_RANGES = {
  all: [undefined, undefined],
  top3: ['1', '3'],
  top10: ['1', '10'],
  p11_20: ['11', '20'],
  p21_100: ['21', '100'],
} as const;
type PositionRange = keyof typeof POSITION_RANGES;

export function DomainKeywordsView() {
  const t = useTranslations('competitors');
  const tk = useTranslations('keywords');
  const format = useFormatter();
  const can = useCan();
  const { domain, loc, lang, params, set } = useDomainParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const changes = (params.changes ?? 'all') as 'all' | 'new' | 'lost';
  const range = (Object.entries(POSITION_RANGES).find(
    ([, [min, max]]) => params.minPosition === min && params.maxPosition === max,
  )?.[0] ?? 'all') as PositionRange;

  const query = useMemo(
    () => ({
      domain: domain || undefined,
      loc: String(loc),
      lang,
      changes: changes === 'all' ? undefined : changes,
      minPosition: params.minPosition,
      maxPosition: params.maxPosition,
      url: params.url,
      sort: params.sort ?? 'traffic',
      dir: params.dir ?? 'desc',
      page: params.page ?? '1',
      pageSize: params.pageSize ?? '50',
      ...Object.fromEntries(FILTER_KEYS.map((k) => [k, params[k]])),
    }),
    [domain, loc, lang, changes, params],
  );
  const result = useDomainKeywords(query);
  const data = result.data;
  const total = data?.total ?? 0;

  const onSort = (field: string) =>
    set({ sort: field, dir: query.sort === field && query.dir === 'desc' ? 'asc' : 'desc' });

  const columns: DataColumn<DomainKeywordRow>[] = [
    {
      id: 'keyword',
      label: t('columns.keyword'),
      header: t('columns.keyword'),
      sortKey: 'keyword',
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
      metric: 'intent',
      hideable: true,
      cell: (r) => <IntentBadges intents={r.intent} />,
    },
    {
      id: 'position',
      label: t('columns.position'),
      header: t('columns.position'),
      sortKey: 'position',
      align: 'right',
      cell: (r) => <span className="tabular">{r.position}</span>,
    },
    {
      id: 'change',
      label: t('columns.change'),
      header: t('columns.change'),
      sortKey: 'change',
      align: 'right',
      hideable: true,
      cell: (r) =>
        changes === 'lost' ? (
          <span className="text-xs text-red-600 dark:text-red-400">{t('lost')}</span>
        ) : (
          <PositionChange change={r.change} />
        ),
    },
    {
      id: 'volume',
      label: t('columns.volume'),
      header: t('columns.volume'),
      metric: 'volume',
      sortKey: 'volume',
      align: 'right',
      cell: (r) => format.number(r.volume),
    },
    {
      id: 'traffic',
      label: t('columns.traffic'),
      header: t('columns.traffic'),
      metric: 'traffic',
      sortKey: 'traffic',
      align: 'right',
      cell: (r) => format.number(Math.round(r.traffic)),
    },
    {
      id: 'kd',
      label: t('columns.kd'),
      header: t('columns.kd'),
      metric: 'kd',
      sortKey: 'kd',
      align: 'right',
      hideable: true,
      cell: (r) => <KdBadge kd={r.kd} />,
    },
    {
      id: 'cpc',
      label: t('columns.cpc'),
      header: t('columns.cpc'),
      metric: 'cpc',
      sortKey: 'cpc',
      align: 'right',
      hideable: true,
      defaultHidden: true,
      cell: (r) =>
        r.cpc === null ? '–' : format.number(r.cpc, { style: 'currency', currency: 'USD' }),
    },
    {
      id: 'url',
      label: t('columns.url'),
      header: t('columns.url'),
      hideable: true,
      cell: (r) => <UrlCell url={r.url} />,
    },
    {
      id: 'features',
      label: tk('columns.features'),
      header: tk('columns.features'),
      hideable: true,
      defaultHidden: true,
      cell: (r) => <FeatureList features={r.serpFeatures} />,
    },
  ];

  return (
    <>
      <PageHeader title={domain || t('title')} description={t('keywordsPage.description')} />
      <CompetitorsTabs />
      <DomainBar key={domain} />

      {!domain ? (
        <EmptyState icon={Globe} title={t('emptyTitle')} description={t('emptyBody')} />
      ) : result.error ? (
        <ErrorState error={result.error} onRetry={() => result.refetch()} />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              label={t('keywordsPage.changes')}
              value={changes}
              onChange={(v) => {
                setSelected(new Set());
                set({ changes: v === 'all' ? null : v });
              }}
              options={(['all', 'new', 'lost'] as const).map((v) => ({
                value: v,
                label: t(`keywordsPage.changeOptions.${v}`),
              }))}
            />
            <Segmented
              label={t('columns.position')}
              value={range}
              onChange={(v) => {
                const [min, max] = POSITION_RANGES[v];
                set({ minPosition: min ?? null, maxPosition: max ?? null });
              }}
              options={(Object.keys(POSITION_RANGES) as PositionRange[]).map((v) => ({
                value: v,
                label: t(`keywordsPage.ranges.${v}`),
              }))}
            />
          </div>
          {params.url && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t('keywordsPage.forUrl')}</span>
              <span className="truncate font-medium">{params.url}</span>
              <Button variant="ghost" size="sm" onClick={() => set({ url: null })}>
                {tk('filters.reset')}
              </Button>
            </div>
          )}

          <FilterBar key={domain} params={params} onApply={(v) => set(v)} />

          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            rowId={(r) => r.keyword}
            caption={t('keywordsPage.results', { count: total })}
            loading={result.isFetching}
            storageKey="domain-keywords"
            sort={{ field: query.sort, dir: query.dir as 'asc' | 'desc' }}
            onSort={onSort}
            selection={{
              selected,
              onChange: setSelected,
              rowLabel: (r) => tk('selectRow', { keyword: r.keyword }),
            }}
            empty={
              <EmptyState
                icon={SearchX}
                title={tk('noResults')}
                description={tk('noResultsBody')}
              />
            }
            toolbar={
              <>
                <span className="text-muted-foreground tabular text-sm">
                  {t('keywordsPage.results', { count: total })}
                </span>
                {selected.size > 0 && (
                  <>
                    <span className="text-sm font-medium">
                      {tk('selected', { count: selected.size })}
                    </span>
                    {can('keywordList:update') && (
                      <AddToListDialog
                        keywords={[...selected]}
                        locationCode={loc}
                        languageCode={lang}
                        onDone={() => setSelected(new Set())}
                      />
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                      {tk('clearSelection')}
                    </Button>
                  </>
                )}
                <ExportMenu path="/domains/keywords/export" params={query} />
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
