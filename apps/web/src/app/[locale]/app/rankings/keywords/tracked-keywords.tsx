'use client';
import {
  LineChart as LineChartIcon,
  Monitor,
  Search,
  SearchX,
  Smartphone,
  Tag,
  Trash2,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { TrackedKeywordRow } from '@seo/shared';
import { Badge } from '@seo/ui/badge';
import { Button } from '@seo/ui/button';
import { Input } from '@seo/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@seo/ui/select';
import { toast } from '@seo/ui/sonner';
import { UrlCell } from '@/components/competitors/position';
import { Segmented } from '@/components/competitors/segmented';
import { DataTable, Pagination, type DataColumn } from '@/components/data-table';
import { FeatureList } from '@/components/keywords/badges';
import { PageHeader } from '@/components/page-header';
import { AddKeywordsDialog } from '@/components/rankings/add-keywords-dialog';
import { CheckNow } from '@/components/rankings/check-now';
import { HistoryDialog } from '@/components/rankings/history-dialog';
import { Change, Position, PositionSparkline } from '@/components/rankings/rank-badges';
import { RankingsTabs } from '@/components/rankings/rankings-tabs';
import { NoProject, useRankProject } from '@/components/rankings/use-rank-project';
import { EmptyState, ErrorState } from '@/components/states';
import { useRankings, useRemoveTracked, useUpdateTrackedTags } from '@/lib/rankings-api';
import { useCan } from '@/lib/queries';
import { useErrorMessage } from '@/lib/use-error-message';
import { useSearchState } from '@/lib/use-search-state';

const RANGES = {
  all: [undefined, undefined],
  top3: ['1', '3'],
  top10: ['1', '10'],
  p11_20: ['11', '20'],
  p21_100: ['21', '100'],
} as const;
type Range = keyof typeof RANGES;
const ALL = '__all__';

export function TrackedKeywordsView() {
  const t = useTranslations('rankings');
  const format = useFormatter();
  const can = useCan();
  const errorMessage = useErrorMessage();
  const project = useRankProject();
  const { params, set } = useSearchState();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState(params.q ?? '');
  const [historyOf, setHistoryOf] = useState<TrackedKeywordRow | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const remove = useRemoveTracked(project?.id ?? '');
  const updateTags = useUpdateTrackedTags(project?.id ?? '');

  const changes = (params.changes ?? 'all') as 'all' | 'up' | 'down' | 'new' | 'lost';
  const device = (params.device ?? 'all') as 'all' | 'desktop' | 'mobile';
  const range = (Object.entries(RANGES).find(
    ([, [min, max]]) => params.minPosition === min && params.maxPosition === max,
  )?.[0] ?? 'all') as Range;

  const query = useMemo(
    () => ({
      q: params.q,
      tag: params.tag,
      device: device === 'all' ? undefined : device,
      changes: changes === 'all' ? undefined : changes,
      minPosition: params.minPosition,
      maxPosition: params.maxPosition,
      sort: params.sort ?? 'position',
      dir: params.dir ?? 'asc',
      page: params.page ?? '1',
      pageSize: params.pageSize ?? '100',
    }),
    [params, device, changes],
  );
  const rankings = useRankings(project?.id, query);
  const data = rankings.data;

  if (!project) return <NoProject />;

  const onSort = (field: string) =>
    set({ sort: field, dir: query.sort === field && query.dir === 'asc' ? 'desc' : 'asc' });
  const rows = data?.items ?? [];
  const selectedRows = rows.filter((r) => selected.has(r.id));

  async function removeSelected() {
    if (!window.confirm(t('keywords.confirmRemove', { count: selected.size }))) return;
    try {
      const res = await remove.mutateAsync([...selected]);
      toast.success(t('keywords.removed', { count: res.removed }));
      setSelected(new Set());
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function tagSelected() {
    const tag = tagInput.trim();
    if (!tag) return;
    try {
      await Promise.all(
        selectedRows.map((r) =>
          updateTags.mutateAsync({ id: r.id, tags: [...new Set([...r.tags, tag])] }),
        ),
      );
      toast.success(t('keywords.tagged', { tag, count: selectedRows.length }));
      setTagInput('');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const columns: DataColumn<TrackedKeywordRow>[] = [
    {
      id: 'keyword',
      label: t('columns.keyword'),
      header: t('columns.keyword'),
      sortKey: 'keyword',
      primary: true,
      cell: (r) => (
        <span className="flex min-w-0 flex-col gap-1">
          <button
            type="button"
            onClick={() => setHistoryOf(r)}
            className="hover:text-primary flex items-center gap-1.5 text-left font-medium hover:underline"
            title={t('keywords.openHistory', { keyword: r.keyword })}
          >
            {r.device === 'mobile' ? (
              <Smartphone
                className="text-muted-foreground size-3.5 shrink-0"
                aria-label={t('devices.mobile')}
              />
            ) : (
              <Monitor
                className="text-muted-foreground size-3.5 shrink-0"
                aria-label={t('devices.desktop')}
              />
            )}
            {r.keyword}
          </button>
          {r.tags.length > 0 && (
            <span className="flex flex-wrap gap-1">
              {r.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="px-1.5 py-0 text-[11px]">
                  {tag}
                </Badge>
              ))}
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'position',
      label: t('columns.position'),
      header: t('columns.position'),
      sortKey: 'position',
      align: 'right',
      cell: (r) => <Position value={r.position} />,
    },
    {
      id: 'change1d',
      label: t('columns.change1d'),
      header: t('columns.change1d'),
      sortKey: 'change1d',
      align: 'right',
      cell: (r) => <Change value={r.change1d} />,
    },
    {
      id: 'change7d',
      label: t('columns.change7d'),
      header: t('columns.change7d'),
      sortKey: 'change7d',
      align: 'right',
      hideable: true,
      cell: (r) => <Change value={r.change7d} />,
    },
    {
      id: 'change30d',
      label: t('columns.change30d'),
      header: t('columns.change30d'),
      sortKey: 'change30d',
      align: 'right',
      hideable: true,
      defaultHidden: true,
      cell: (r) => <Change value={r.change30d} />,
    },
    {
      id: 'best',
      label: t('columns.best'),
      header: t('columns.best'),
      sortKey: 'best',
      align: 'right',
      hideable: true,
      cell: (r) => (r.best === null ? '–' : <span className="tabular">{r.best}</span>),
    },
    {
      id: 'trend',
      label: t('columns.trend'),
      header: t('columns.trend'),
      hideable: true,
      cell: (r) => <PositionSparkline values={r.history} label={t('columns.trend')} />,
    },
    {
      id: 'volume',
      label: t('columns.volume'),
      header: t('columns.volume'),
      metric: 'volume',
      sortKey: 'volume',
      align: 'right',
      hideable: true,
      cell: (r) => format.number(r.volume),
    },
    {
      id: 'traffic',
      label: t('columns.traffic'),
      header: t('columns.traffic'),
      metric: 'traffic',
      sortKey: 'traffic',
      align: 'right',
      hideable: true,
      cell: (r) => format.number(Math.round(r.traffic)),
    },
    {
      id: 'url',
      label: t('columns.url'),
      header: t('columns.url'),
      hideable: true,
      cell: (r) =>
        r.url ? <UrlCell url={r.url} /> : <span className="text-muted-foreground">–</span>,
    },
    ...(data?.competitors ?? []).map((d, i): DataColumn<TrackedKeywordRow> => ({
      id: `comp-${d}`,
      label: d,
      header: (
        <span className="block max-w-28 truncate" title={d}>
          {d}
        </span>
      ),
      align: 'right',
      hideable: true,
      defaultHidden: i >= 2,
      cell: (r) => <Position value={r.competitors[d] ?? null} />,
    })),
    {
      id: 'features',
      label: t('columns.features'),
      header: t('columns.features'),
      hideable: true,
      defaultHidden: true,
      cell: (r) => <FeatureList features={r.serpFeatures} />,
    },
  ];

  const total = data?.total ?? 0;
  const editable = can('rankTracking:update');
  return (
    <>
      <PageHeader
        title={t('keywords.title')}
        description={project.domain}
        actions={
          data && (
            <>
              <CheckNow
                projectId={project.id}
                lastCheckedAt={data.lastCheckedAt}
                keywords={data.limit.used}
                initialJobId={jobId}
              />
              {editable && can('research:run') && (
                <AddKeywordsDialog
                  projectId={project.id}
                  limit={data.limit}
                  defaultOpen={params.add === '1'}
                  onStarted={(job) => setJobId(job.id)}
                />
              )}
            </>
          )
        }
      />
      <RankingsTabs />

      {rankings.error ? (
        <ErrorState error={rankings.error} onRetry={() => rankings.refetch()} />
      ) : data && data.limit.used === 0 ? (
        <EmptyState icon={LineChartIcon} title={t('emptyTitle')} description={t('emptyBody')} />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <form
              className="relative flex-1"
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
                placeholder={t('keywords.search')}
                aria-label={t('keywords.search')}
                className="pl-9"
              />
            </form>
            {(data?.tags.length ?? 0) > 0 && (
              <Select
                value={params.tag ?? ALL}
                onValueChange={(v) => set({ tag: v === ALL ? null : v })}
              >
                <SelectTrigger className="w-44" aria-label={t('keywords.tag')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('keywords.allTags')}</SelectItem>
                  {data!.tags.map((tag) => (
                    <SelectItem key={tag} value={tag}>
                      {tag}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              label={t('keywords.changes')}
              value={changes}
              onChange={(v) => {
                setSelected(new Set());
                set({ changes: v === 'all' ? null : v });
              }}
              options={(['all', 'up', 'down', 'new', 'lost'] as const).map((v) => ({
                value: v,
                label: t(`keywords.changeOptions.${v}`),
              }))}
            />
            <Segmented
              label={t('columns.position')}
              value={range}
              onChange={(v) => {
                const [min, max] = RANGES[v];
                set({ minPosition: min ?? null, maxPosition: max ?? null });
              }}
              options={(Object.keys(RANGES) as Range[]).map((v) => ({
                value: v,
                label: t(`keywords.ranges.${v}`),
              }))}
            />
          </div>

          <DataTable
            columns={columns}
            rows={rows}
            rowId={(r) => r.id}
            caption={t('keywords.results', { count: total })}
            loading={rankings.isFetching}
            storageKey="tracked-keywords"
            sort={{ field: query.sort, dir: query.dir as 'asc' | 'desc' }}
            onSort={onSort}
            selection={
              editable
                ? {
                    selected,
                    onChange: setSelected,
                    rowLabel: (r) => t('keywords.selectRow', { keyword: r.keyword }),
                  }
                : undefined
            }
            empty={<EmptyState icon={SearchX} title={t('keywords.noResults')} />}
            toolbar={
              <>
                <span className="text-muted-foreground tabular text-sm">
                  {t('keywords.results', { count: total })}
                  {data &&
                    ` · ${t('keywords.usage', { used: data.limit.used, max: data.limit.max })}`}
                </span>
                {selected.size > 0 && (
                  <>
                    <span className="text-sm font-medium">
                      {t('keywords.selected', { count: selected.size })}
                    </span>
                    <form
                      className="flex items-center gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void tagSelected();
                      }}
                    >
                      <Input
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        placeholder={t('keywords.tagPlaceholder')}
                        aria-label={t('keywords.tagPlaceholder')}
                        className="h-8 w-32"
                      />
                      <Button type="submit" size="sm" variant="outline" disabled={!tagInput.trim()}>
                        <Tag aria-hidden /> {t('keywords.addTag')}
                      </Button>
                    </form>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={removeSelected}
                      disabled={remove.isPending}
                    >
                      <Trash2 aria-hidden /> {t('keywords.remove')}
                    </Button>
                  </>
                )}
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

      <HistoryDialog
        projectId={project.id}
        projectDomain={project.domain}
        keywordId={historyOf?.id ?? null}
        keyword={historyOf?.keyword ?? ''}
        onClose={() => setHistoryOf(null)}
      />
    </>
  );
}
