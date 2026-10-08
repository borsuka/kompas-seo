'use client';
import { Search, SearchX } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent } from 'react';
import { IDEA_SOURCES, type KeywordRow } from '@seo/shared';
import { Button } from '@seo/ui/button';
import { cn } from '@seo/ui/cn';
import { Input } from '@seo/ui/input';
import { useCurrentProject } from '@/components/app-shell/project-context';
import { DataTable, Pagination, type DataColumn } from '@/components/data-table';
import { AddToListDialog } from '@/components/keywords/add-to-list-dialog';
import { FeatureList, IntentBadges, KdBadge, Sparkline } from '@/components/keywords/badges';
import { ExportMenu } from '@/components/keywords/export-menu';
import { FilterBar, FILTER_KEYS } from '@/components/keywords/filter-bar';
import { KeywordsTabs } from '@/components/keywords/keywords-tabs';
import { LocalePicker } from '@/components/keywords/locale-picker';
import { MetricLabel } from '@/components/metric-tooltip';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState } from '@/components/states';
import { Link } from '@/i18n/navigation';
import { useCan } from '@/lib/queries';
import { useExplore } from '@/lib/keywords-api';
import { useSearchState } from '@/lib/use-search-state';

const EXAMPLES = ['seo оптимизация', 'онлайн магазин', 'зъболекар софия'];

export function KeywordExplorer() {
  const t = useTranslations('keywords');
  const format = useFormatter();
  const can = useCan();
  const { current } = useCurrentProject();
  const { params, set } = useSearchState();
  const loc = Number(params.loc ?? current?.locationCode ?? 2100);
  const lang = params.lang ?? current?.languageCode ?? 'bg';
  const [input, setInput] = useState(params.q ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const query = useMemo(
    () => ({
      q: params.q,
      loc: String(loc),
      lang,
      source: params.source,
      sort: params.sort ?? 'volume',
      dir: params.dir ?? 'desc',
      page: params.page ?? '1',
      pageSize: params.pageSize ?? '50',
      ...Object.fromEntries(FILTER_KEYS.map((k) => [k, params[k]])),
    }),
    [params, loc, lang],
  );
  const explore = useExplore(query);
  const data = explore.data;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setSelected(new Set());
    set({ q: input.trim(), loc, lang, source: null });
  }

  const onSort = (field: string) =>
    set({ sort: field, dir: query.sort === field && query.dir === 'desc' ? 'asc' : 'desc' });

  const overviewHref = (kw: string) =>
    `/app/keywords/overview?q=${encodeURIComponent(kw)}&loc=${loc}&lang=${lang}`;

  const columns: DataColumn<KeywordRow>[] = [
    {
      id: 'keyword',
      label: t('columns.keyword'),
      header: t('columns.keyword'),
      sortKey: 'keyword',
      primary: true,
      cell: (r) => (
        <Link
          href={overviewHref(r.keyword)}
          className="hover:text-primary font-medium hover:underline"
          title={t('openOverview', { keyword: r.keyword })}
        >
          {r.keyword}
        </Link>
      ),
    },
    {
      id: 'intent',
      label: t('columns.intent'),
      header: <MetricLabel metric="intent" label={t('columns.intent')} />,
      hideable: true,
      cell: (r) => <IntentBadges intents={r.intent} />,
    },
    {
      id: 'volume',
      label: t('columns.volume'),
      header: <MetricLabel metric="volume" label={t('columns.volume')} />,
      sortKey: 'volume',
      align: 'right',
      cell: (r) => format.number(r.volume),
    },
    {
      id: 'trend',
      label: t('columns.trend'),
      header: t('columns.trend'),
      hideable: true,
      cell: (r) => <Sparkline values={r.trend} label={t('columns.trend')} />,
    },
    {
      id: 'kd',
      label: t('columns.kd'),
      header: <MetricLabel metric="kd" label={t('columns.kd')} />,
      sortKey: 'kd',
      align: 'right',
      hideable: true,
      cell: (r) => <KdBadge kd={r.kd} />,
    },
    {
      id: 'cpc',
      label: t('columns.cpc'),
      header: <MetricLabel metric="cpc" label={t('columns.cpc')} />,
      sortKey: 'cpc',
      align: 'right',
      hideable: true,
      cell: (r) =>
        r.cpc === null ? '–' : format.number(r.cpc, { style: 'currency', currency: 'USD' }),
    },
    {
      id: 'competition',
      label: t('columns.competition'),
      header: <MetricLabel metric="competition" label={t('columns.competition')} />,
      sortKey: 'competition',
      align: 'right',
      hideable: true,
      defaultHidden: true,
      cell: (r) =>
        r.competition === null ? '–' : format.number(r.competition, { maximumFractionDigits: 2 }),
    },
    {
      id: 'features',
      label: t('columns.features'),
      header: t('columns.features'),
      hideable: true,
      cell: (r) => <FeatureList features={r.serpFeatures} />,
    },
    {
      id: 'words',
      label: t('columns.words'),
      header: t('columns.words'),
      sortKey: 'wordCount',
      align: 'right',
      hideable: true,
      defaultHidden: true,
      cell: (r) => r.wordCount,
    },
  ];

  const selectedKeywords = [...selected];
  const total = data?.total ?? 0;

  return (
    <>
      <PageHeader title={t('title')} />
      <KeywordsTabs />
      <form onSubmit={submit} className="mb-4 flex flex-col gap-2 lg:flex-row">
        <div className="relative flex-1">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
            className="h-10 pl-9"
          />
        </div>
        <LocalePicker loc={loc} lang={lang} onChange={(l, lg) => set({ loc: l, lang: lg })} />
        <Button type="submit" className="h-10" disabled={!input.trim()}>
          {t('search')}
        </Button>
      </form>

      {!params.q ? (
        <EmptyState icon={Search} title={t('emptyTitle')} description={t('emptyBody')}>
          <div className="flex flex-wrap justify-center gap-2" aria-label={t('examples')}>
            {EXAMPLES.map((ex) => (
              <Button
                key={ex}
                variant="outline"
                size="sm"
                onClick={() => {
                  setInput(ex);
                  set({ q: ex, loc, lang });
                }}
              >
                {ex}
              </Button>
            ))}
          </div>
        </EmptyState>
      ) : explore.error ? (
        <ErrorState error={explore.error} onRetry={() => explore.refetch()} />
      ) : (
        <div className="space-y-3">
          <div
            className="flex flex-wrap items-center gap-2"
            role="tablist"
            aria-label={t('columns.keyword')}
          >
            {[undefined, ...IDEA_SOURCES].map((s) => {
              const count = s
                ? (data?.sourceCounts[s] ?? 0)
                : Object.values(data?.sourceCounts ?? {}).reduce((a, b) => a + b, 0);
              const active = (params.source ?? undefined) === s;
              return (
                <button
                  key={s ?? 'all'}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => set({ source: s ?? null })}
                  className={cn(
                    'rounded-full border px-3 py-1 text-sm transition-colors',
                    active
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border hover:bg-muted',
                  )}
                >
                  {t(`sources.${s ?? 'all'}`)}{' '}
                  <span className="tabular text-muted-foreground">{format.number(count)}</span>
                </button>
              );
            })}
          </div>

          <FilterBar key={params.q} params={params} onApply={(v) => set(v)} />

          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            rowId={(r) => r.keyword}
            caption={t('results', { count: total })}
            loading={explore.isFetching}
            storageKey="explorer"
            sort={{ field: query.sort, dir: query.dir as 'asc' | 'desc' }}
            onSort={onSort}
            selection={{
              selected,
              onChange: setSelected,
              rowLabel: (r) => t('selectRow', { keyword: r.keyword }),
            }}
            empty={
              <EmptyState icon={SearchX} title={t('noResults')} description={t('noResultsBody')} />
            }
            toolbar={
              <>
                <span className="text-muted-foreground tabular text-sm">
                  {t('results', { count: total })}
                </span>
                {selected.size > 0 && (
                  <>
                    <span className="text-sm font-medium">
                      {t('selected', { count: selected.size })}
                    </span>
                    {can('keywordList:update') && (
                      <AddToListDialog
                        keywords={selectedKeywords}
                        locationCode={loc}
                        languageCode={lang}
                        onDone={() => setSelected(new Set())}
                      />
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                      {t('clearSelection')}
                    </Button>
                  </>
                )}
                <ExportMenu path="/keywords/explore/export" params={query} />
              </>
            }
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">
              {data &&
                t('dataFrom', {
                  date: format.dateTime(new Date(data.fetchedAt), { dateStyle: 'medium' }),
                })}
              {data &&
                data.creditsCharged > 0 &&
                ` · ${t('creditsSpent', { count: data.creditsCharged })}`}
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
