'use client';
import { GitCompare, SearchX } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { GAP_TABS, type GapTab, type KeywordGapRow } from '@seo/shared';
import { Button } from '@seo/ui/button';
import { CompetitorsTabs } from '@/components/competitors/competitors-tabs';
import { GapForm, useGapParams } from '@/components/competitors/gap-form';
import { GapPosition } from '@/components/competitors/position';
import { Segmented } from '@/components/competitors/segmented';
import { DataTable, Pagination, type DataColumn } from '@/components/data-table';
import { AddToListDialog } from '@/components/keywords/add-to-list-dialog';
import { IntentBadges, KdBadge } from '@/components/keywords/badges';
import { ExportMenu } from '@/components/keywords/export-menu';
import { FilterBar, FILTER_KEYS } from '@/components/keywords/filter-bar';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState } from '@/components/states';
import { Link } from '@/i18n/navigation';
import { useKeywordGap } from '@/lib/domains-api';
import { useCan } from '@/lib/queries';

export function KeywordGapView() {
  const t = useTranslations('competitors');
  const tk = useTranslations('keywords');
  const format = useFormatter();
  const can = useCan();
  const { target, competitors, loc, lang, confirmed, params, set } = useGapParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const tab = (GAP_TABS as readonly string[]).includes(params.tab ?? '')
    ? (params.tab as GapTab)
    : 'missing';

  const query = useMemo(
    () => ({
      target: confirmed ? target : undefined,
      competitors: confirmed ? competitors.join(',') : undefined,
      loc: String(loc),
      lang,
      tab,
      sort: params.sort ?? 'volume',
      dir: params.dir ?? 'desc',
      page: params.page ?? '1',
      pageSize: params.pageSize ?? '50',
      ...Object.fromEntries(FILTER_KEYS.map((k) => [k, params[k]])),
    }),
    [confirmed, target, competitors, loc, lang, tab, params],
  );
  const gap = useKeywordGap(query);
  const data = gap.data;
  const total = data?.total ?? 0;

  const onSort = (field: string) =>
    set({ sort: field, dir: query.sort === field && query.dir === 'desc' ? 'asc' : 'desc' });

  const domains = data?.domains ?? [target, ...competitors];
  const columns: DataColumn<KeywordGapRow>[] = [
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
      id: 'volume',
      label: t('columns.volume'),
      header: t('columns.volume'),
      metric: 'volume',
      sortKey: 'volume',
      align: 'right',
      cell: (r) => format.number(r.volume),
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
    ...domains.map((d, i): DataColumn<KeywordGapRow> => ({
      id: `pos-${d}`,
      label: d,
      header: (
        <span className={i === 0 ? 'text-primary font-semibold' : undefined} title={d}>
          <span className="block max-w-28 truncate">{d}</span>
        </span>
      ),
      align: 'right',
      cell: (r) => {
        const pos = r.positions[d] ?? null;
        const best = Math.min(...Object.values(r.positions).filter((p): p is number => p !== null));
        return <GapPosition position={pos} best={pos !== null && pos === best} />;
      },
    })),
  ];

  return (
    <>
      <PageHeader title={t('gap.title')} description={t('gap.description')} />
      <CompetitorsTabs />
      <GapForm key={`${target}|${competitors.join(',')}`} />

      {!confirmed ? (
        <EmptyState
          icon={GitCompare}
          title={t('gap.emptyTitle')}
          description={t('gap.emptyBody')}
        />
      ) : gap.error ? (
        <ErrorState error={gap.error} onRetry={() => gap.refetch()} />
      ) : (
        <div className="space-y-3">
          <Segmented
            label={t('gap.title')}
            value={tab}
            onChange={(v) => {
              setSelected(new Set());
              set({ tab: v });
            }}
            options={GAP_TABS.map((v) => ({
              value: v,
              label: t(`gap.tabs.${v}`),
              count: data ? format.number(data.counts[v] ?? 0) : undefined,
            }))}
          />
          <p className="text-muted-foreground text-sm">{t(`gap.tabHints.${tab}`)}</p>

          <FilterBar key={tab} params={params} onApply={(v) => set(v)} />

          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            rowId={(r) => r.keyword}
            caption={t('gap.results', { count: total })}
            loading={gap.isFetching}
            storageKey="keyword-gap"
            sort={{ field: query.sort, dir: query.dir as 'asc' | 'desc' }}
            onSort={onSort}
            selection={{
              selected,
              onChange: setSelected,
              rowLabel: (r) => tk('selectRow', { keyword: r.keyword }),
            }}
            empty={<EmptyState icon={SearchX} title={t('gap.noResults')} />}
            toolbar={
              <>
                <span className="text-muted-foreground tabular text-sm">
                  {t('gap.results', { count: total })}
                </span>
                {can('keywordList:update') && (
                  <AddToListDialog
                    keywords={
                      selected.size > 0 ? [...selected] : (data?.items ?? []).map((r) => r.keyword)
                    }
                    locationCode={loc}
                    languageCode={lang}
                    onDone={() => setSelected(new Set())}
                    defaultName={t('gap.listName', { tab: t(`gap.tabs.${tab}`), domain: target })}
                    label={
                      selected.size > 0
                        ? tk('selected', { count: selected.size })
                        : t('gap.addPage', { count: data?.items.length ?? 0 })
                    }
                  />
                )}
                {selected.size > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                    {tk('clearSelection')}
                  </Button>
                )}
                <ExportMenu path="/domains/keyword-gap/export" params={query} />
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
