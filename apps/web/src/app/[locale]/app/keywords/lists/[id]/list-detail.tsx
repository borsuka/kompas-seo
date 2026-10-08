'use client';
import { ArrowLeft, Network, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { KeywordListItem } from '@seo/shared';
import { Button } from '@seo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@seo/ui/card';
import { cn } from '@seo/ui/cn';
import { Input } from '@seo/ui/input';
import { Skeleton } from '@seo/ui/skeleton';
import { toast } from '@seo/ui/sonner';
import { useQueryClient } from '@tanstack/react-query';
import { DataTable, Pagination, type DataColumn } from '@/components/data-table';
import { FeatureList, IntentBadges, KdBadge, Sparkline } from '@/components/keywords/badges';
import { ExportMenu } from '@/components/keywords/export-menu';
import { FilterBar, FILTER_KEYS } from '@/components/keywords/filter-bar';
import { KeywordsTabs } from '@/components/keywords/keywords-tabs';
import { MetricLabel } from '@/components/metric-tooltip';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/states';
import { Link, useRouter } from '@/i18n/navigation';
import {
  useAddItems,
  useClusters,
  useDeleteList,
  useKeywordList,
  useListItems,
  useRemoveItems,
  useStartCluster,
  useUpdateItem,
} from '@/lib/keywords-api';
import { useCan } from '@/lib/queries';
import { useErrorMessage } from '@/lib/use-error-message';
import { useJobProgress } from '@/lib/use-job-progress';
import { useSearchState } from '@/lib/use-search-state';

/** Inline note editor: saves on blur when changed. */
function NoteCell({
  item,
  listId,
  disabled,
}: {
  item: KeywordListItem;
  listId: string;
  disabled: boolean;
}) {
  const t = useTranslations('keywords.lists');
  const update = useUpdateItem(listId);
  const [value, setValue] = useState(item.note ?? '');
  if (disabled) return <span className="text-muted-foreground">{item.note ?? '–'}</span>;
  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value !== (item.note ?? '')) update.mutate({ itemId: item.id, note: value || null });
      }}
      placeholder={t('notePlaceholder')}
      aria-label={t('note')}
      className="h-7 min-w-40 text-xs"
    />
  );
}

function TagsCell({
  item,
  listId,
  disabled,
}: {
  item: KeywordListItem;
  listId: string;
  disabled: boolean;
}) {
  const t = useTranslations('keywords.lists');
  const update = useUpdateItem(listId);
  const [value, setValue] = useState(item.tags.join(', '));
  if (disabled) return <span className="text-muted-foreground">{item.tags.join(', ') || '–'}</span>;
  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const tags = [
          ...new Set(
            value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        ];
        if (tags.join(',') !== item.tags.join(',')) update.mutate({ itemId: item.id, tags });
      }}
      placeholder={t('tagsPlaceholder')}
      aria-label={t('tags')}
      className="h-7 min-w-32 text-xs"
    />
  );
}

export function KeywordListDetail({ id }: { id: string }) {
  const t = useTranslations('keywords');
  const format = useFormatter();
  const can = useCan();
  const router = useRouter();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const editable = can('keywordList:update');
  const { params, set } = useSearchState();
  const list = useKeywordList(id);
  const query = useMemo(
    () => ({
      sort: params.sort ?? 'volume',
      dir: params.dir ?? 'desc',
      page: params.page ?? '1',
      pageSize: params.pageSize ?? '100',
      cluster: params.cluster,
      tag: params.tag,
      ...Object.fromEntries(FILTER_KEYS.map((k) => [k, params[k]])),
    }),
    [params],
  );
  const items = useListItems(id, query);
  const clusters = useClusters(id);
  const addItems = useAddItems();
  const removeItems = useRemoveItems(id);
  const removeList = useDeleteList();
  const startCluster = useStartCluster(id);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newKeywords, setNewKeywords] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJobProgress(jobId);

  useEffect(() => {
    if (job?.status === 'completed') {
      toast.success(t('lists.clusterDone'));
      void qc.invalidateQueries({ queryKey: ['keyword-lists', id] });
      // eslint-disable-next-line react-hooks/set-state-in-effect -- job finished: stop following it
      setJobId(null);
    } else if (job?.status === 'failed') {
      toast.error(job.error ?? '');
      setJobId(null);
    }
  }, [job?.status, job?.error, id, qc, t]);

  async function add(e: FormEvent) {
    e.preventDefault();
    const keywords = [
      ...new Set(
        newKeywords
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
    if (!keywords.length) return;
    try {
      const res = await addItems.mutateAsync({ listId: id, keywords });
      toast.success(t('lists.added', { added: res.added, skipped: res.skipped }));
      setNewKeywords('');
      void qc.invalidateQueries({ queryKey: ['keyword-lists', id] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const columns: DataColumn<KeywordListItem>[] = [
    {
      id: 'keyword',
      label: t('columns.keyword'),
      header: t('columns.keyword'),
      sortKey: 'keyword',
      primary: true,
      cell: (r) =>
        list.data ? (
          <Link
            href={`/app/keywords/overview?q=${encodeURIComponent(r.keyword)}&loc=${list.data.locationCode}&lang=${list.data.languageCode}`}
            className="hover:text-primary font-medium hover:underline"
          >
            {r.keyword}
          </Link>
        ) : (
          r.keyword
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
      defaultHidden: true,
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
      header: t('columns.cpc'),
      sortKey: 'cpc',
      align: 'right',
      hideable: true,
      cell: (r) =>
        r.cpc === null ? '–' : format.number(r.cpc, { style: 'currency', currency: 'USD' }),
    },
    {
      id: 'features',
      label: t('columns.features'),
      header: t('columns.features'),
      hideable: true,
      defaultHidden: true,
      cell: (r) => <FeatureList features={r.serpFeatures} />,
    },
    {
      id: 'cluster',
      label: t('columns.cluster'),
      header: t('columns.cluster'),
      hideable: true,
      cell: (r) => r.cluster ?? '–',
    },
    {
      id: 'tags',
      label: t('columns.tags'),
      header: t('columns.tags'),
      hideable: true,
      cell: (r) => (
        <TagsCell key={`${r.id}-${r.tags.join()}`} item={r} listId={id} disabled={!editable} />
      ),
    },
    {
      id: 'note',
      label: t('columns.note'),
      header: t('columns.note'),
      hideable: true,
      cell: (r) => <NoteCell key={`${r.id}-${r.note}`} item={r} listId={id} disabled={!editable} />,
    },
  ];

  if (list.error) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  if (!list.data) return <Skeleton className="h-64" />;
  const l = list.data;
  const clustering = !!jobId;

  return (
    <>
      <PageHeader
        title={l.name}
        description={t('lists.items', { count: l.itemCount })}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/app/keywords/lists">
                <ArrowLeft aria-hidden /> {t('lists.back')}
              </Link>
            </Button>
            {can('keywordList:delete') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (!window.confirm(t('lists.deleteConfirm'))) return;
                  removeList.mutate(id, { onSuccess: () => router.push('/app/keywords/lists') });
                }}
              >
                <Trash2 aria-hidden /> {t('lists.deleteList')}
              </Button>
            )}
          </>
        }
      />
      <KeywordsTabs />

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0 space-y-3">
          <FilterBar params={params} onApply={(v) => set(v)} />
          <DataTable
            columns={columns}
            rows={items.data?.items ?? []}
            rowId={(r) => r.id}
            caption={l.name}
            loading={items.isFetching}
            storageKey="keyword-list"
            sort={{ field: query.sort, dir: query.dir as 'asc' | 'desc' }}
            onSort={(field) =>
              set({
                sort: field,
                dir: query.sort === field && query.dir === 'desc' ? 'asc' : 'desc',
              })
            }
            selection={
              editable
                ? {
                    selected,
                    onChange: setSelected,
                    rowLabel: (r) => t('selectRow', { keyword: r.keyword }),
                  }
                : undefined
            }
            toolbar={
              <>
                {selected.size > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      removeItems.mutate([...selected], {
                        onSuccess: () => setSelected(new Set()),
                        onError: (err) => toast.error(errorMessage(err)),
                      })
                    }
                  >
                    <Trash2 aria-hidden /> {t('lists.removeSelected')} ({selected.size})
                  </Button>
                )}
                <ExportMenu path={`/keyword-lists/${id}/export`} params={{}} />
              </>
            }
          />
          <Pagination
            page={Number(query.page)}
            pageSize={Number(query.pageSize)}
            total={items.data?.total ?? 0}
            onPage={(p) => set({ page: p })}
            onPageSize={(s) => set({ pageSize: s })}
          />
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>{t('lists.clusters')}</h2>
              </CardTitle>
              <CardDescription>{t('lists.clusterHelp')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {editable && (
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={clustering || l.itemCount < 2 || startCluster.isPending}
                  onClick={() =>
                    startCluster.mutate(undefined, {
                      onSuccess: (j) => setJobId(j.id),
                      onError: (err) => toast.error(errorMessage(err)),
                    })
                  }
                >
                  <Network aria-hidden />
                  {clustering
                    ? t('lists.clustering', { progress: Math.round(job?.progress ?? 0) })
                    : t('lists.cluster')}
                </Button>
              )}
              {clustering && (
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(job?.progress ?? 0)}
                  aria-label={t('lists.cluster')}
                  className="bg-muted h-1.5 overflow-hidden rounded-full"
                >
                  <div
                    className="bg-primary h-full transition-[width]"
                    style={{ width: `${job?.progress ?? 0}%` }}
                  />
                </div>
              )}
              <p className="text-muted-foreground text-xs">
                {l.clusteredAt
                  ? t('lists.clusteredAt', {
                      date: format.dateTime(new Date(l.clusteredAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                    })
                  : t('lists.notClustered')}
              </p>
              {(clusters.data?.length ?? 0) > 0 && (
                <ul className="max-h-96 space-y-0.5 overflow-y-auto text-sm">
                  <li>
                    <button
                      type="button"
                      onClick={() => set({ cluster: null })}
                      className={cn(
                        'hover:bg-muted w-full rounded-md px-2 py-1 text-left',
                        !params.cluster && 'bg-muted font-medium',
                      )}
                    >
                      {t('lists.allClusters')}
                    </button>
                  </li>
                  {clusters.data!.map((c) => (
                    <li key={c.name}>
                      <button
                        type="button"
                        onClick={() => set({ cluster: c.name })}
                        className={cn(
                          'hover:bg-muted flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left',
                          params.cluster === c.name && 'bg-muted font-medium',
                        )}
                      >
                        <span className="truncate">{c.name}</span>
                        <span className="text-muted-foreground tabular shrink-0 text-xs">
                          {c.keywords} · {format.number(c.totalVolume, { notation: 'compact' })}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {editable && (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>{t('lists.addKeywords')}</h2>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={add} className="space-y-2">
                  <textarea
                    value={newKeywords}
                    onChange={(e) => setNewKeywords(e.target.value)}
                    placeholder={t('lists.addKeywordsPlaceholder')}
                    aria-label={t('lists.addKeywords')}
                    rows={5}
                    className="border-input bg-background focus-visible:ring-ring/40 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!newKeywords.trim() || addItems.isPending}
                  >
                    {t('lists.add')}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
