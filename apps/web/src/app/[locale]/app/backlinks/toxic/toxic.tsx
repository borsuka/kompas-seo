'use client';
import { Download, FolderPlus, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { normalizeDomain, type ToxicDomain } from '@seo/shared';
import { Button } from '@seo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@seo/ui/card';
import { toast } from '@seo/ui/sonner';
import { useCurrentProject } from '@/components/app-shell/project-context';
import { BacklinksTabs } from '@/components/backlinks/backlinks-tabs';
import { Rating, ToxicityBadge } from '@/components/backlinks/badges';
import { Segmented } from '@/components/competitors/segmented';
import { DataTable, Pagination, type DataColumn } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState } from '@/components/states';
import { Link } from '@/i18n/navigation';
import {
  disavowExportUrl,
  useAddDisavow,
  useDisavow,
  useRemoveDisavow,
  useToxic,
} from '@/lib/backlinks-api';
import { useCan } from '@/lib/queries';
import { useErrorMessage } from '@/lib/use-error-message';
import { useSearchState } from '@/lib/use-search-state';

const LEVELS = ['medium', 'high', 'all'] as const;
const DISAVOWED = ['all', 'no', 'yes'] as const;

/** One entry per line: full URLs stay URLs, anything else must be a domain. */
function parseEntries(text: string) {
  const entries: { type: 'domain' | 'url'; value: string }[] = [];
  const invalid: string[] = [];
  for (const raw of text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const v = raw.replace(/^domain:/i, '');
    if (/^https?:\/\//i.test(v) && v.replace(/^https?:\/\//i, '').includes('/'))
      entries.push({ type: 'url', value: v });
    else {
      const d = normalizeDomain(v);
      if (d) entries.push({ type: 'domain', value: d });
      else invalid.push(raw);
    }
  }
  return { entries, invalid };
}

export function ToxicView() {
  const t = useTranslations('backlinks.toxic');
  const tb = useTranslations('backlinks');
  const format = useFormatter();
  const can = useCan();
  const errorMessage = useErrorMessage();
  const { current } = useCurrentProject();
  const { params, set } = useSearchState();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [text, setText] = useState('');
  const level = (params.level ?? 'medium') as (typeof LEVELS)[number];
  const disavowedFilter = (params.disavowed ?? 'all') as (typeof DISAVOWED)[number];
  const query = {
    level,
    disavowed: disavowedFilter,
    page: params.page ?? '1',
    pageSize: params.pageSize ?? '50',
  };
  const toxic = useToxic(current?.id, query);
  const disavow = useDisavow(current?.id);
  const add = useAddDisavow(current?.id ?? '');
  const remove = useRemoveDisavow(current?.id ?? '');
  const data = toxic.data;
  const editable = can('project:update');

  if (!current)
    return (
      <>
        <PageHeader title={t('title')} />
        <BacklinksTabs />
        <EmptyState
          icon={FolderPlus}
          title={t('noProject')}
          action={
            <Button asChild>
              <Link href="/onboarding">{t('createProject')}</Link>
            </Button>
          }
        />
      </>
    );

  async function addEntries(entries: { type: 'domain' | 'url'; value: string; reason?: string }[]) {
    try {
      const res = await add.mutateAsync({ entries });
      toast.success(t('added', { added: res.added, skipped: res.skipped }));
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    }
  }

  async function disavowSelected() {
    const rows = (data?.items ?? []).filter((r) => selected.has(r.domain));
    const ok = await addEntries(
      rows.map((r) => ({
        type: 'domain',
        value: r.domain,
        reason: t('reason', { score: r.toxicity.score }),
      })),
    );
    if (ok) setSelected(new Set());
  }

  async function submitManual(e: FormEvent) {
    e.preventDefault();
    const { entries, invalid } = parseEntries(text);
    if (invalid.length)
      return toast.error(t('invalid', { values: invalid.slice(0, 3).join(', ') }));
    if (entries.length && (await addEntries(entries))) setText('');
  }

  const columns: DataColumn<ToxicDomain>[] = [
    {
      id: 'domain',
      label: tb('columns.domain'),
      header: tb('columns.domain'),
      primary: true,
      cell: (r) => (
        <span className="flex flex-col">
          <span className="font-medium">{r.domain}</span>
          {r.toxicity.reasons.length > 0 && (
            <span className="text-muted-foreground text-xs">
              {r.toxicity.reasons.map((x) => tb(`toxicity.reasons.${x}`)).join(' · ')}
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'toxicity',
      label: tb('columns.toxicity'),
      header: tb('columns.toxicity'),
      metric: 'toxicity',
      align: 'right',
      cell: (r) => <ToxicityBadge value={r.toxicity} />,
    },
    {
      id: 'rating',
      label: tb('columns.rating'),
      header: tb('columns.rating'),
      align: 'right',
      hideable: true,
      cell: (r) => <Rating value={r.rating} />,
    },
    {
      id: 'backlinks',
      label: tb('columns.backlinks'),
      header: tb('columns.backlinks'),
      align: 'right',
      hideable: true,
      cell: (r) => format.number(r.backlinks),
    },
    {
      id: 'status',
      label: t('status'),
      header: t('status'),
      cell: (r) =>
        r.disavowed ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="size-3.5" aria-hidden /> {t('disavowed')}
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">{t('active')}</span>
        ),
    },
  ];

  const total = data?.total ?? 0;
  return (
    <>
      <PageHeader title={t('title')} description={t('description', { domain: current.domain })} />
      <BacklinksTabs />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(['high', 'medium', 'low'] as const).map((l) => (
          <Card key={l}>
            <CardHeader className="pb-2">
              <CardDescription>{tb(`toxicity.levels.${l}`)}</CardDescription>
              <CardTitle className="tabular text-2xl">
                {data ? format.number(data.counts[l]) : '–'}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('disavowedCount')}</CardDescription>
            <CardTitle className="tabular text-2xl">
              {data ? format.number(data.disavowed) : '–'}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              label={t('level')}
              value={level}
              onChange={(v) => {
                setSelected(new Set());
                set({ level: v === 'medium' ? null : v });
              }}
              options={LEVELS.map((v) => ({ value: v, label: t(`levels.${v}`) }))}
            />
            <Segmented
              label={t('status')}
              value={disavowedFilter}
              onChange={(v) => set({ disavowed: v === 'all' ? null : v })}
              options={DISAVOWED.map((v) => ({ value: v, label: t(`disavowedFilter.${v}`) }))}
            />
          </div>
          {toxic.error ? (
            <ErrorState error={toxic.error} onRetry={() => toxic.refetch()} />
          ) : (
            <DataTable
              columns={columns}
              rows={data?.items ?? []}
              rowId={(r) => r.domain}
              caption={t('results', { count: total })}
              loading={toxic.isFetching}
              storageKey="toxic-domains"
              selection={
                editable
                  ? {
                      selected,
                      onChange: setSelected,
                      rowLabel: (r) => t('selectRow', { domain: r.domain }),
                    }
                  : undefined
              }
              empty={
                <EmptyState icon={ShieldCheck} title={t('none')} description={t('noneBody')} />
              }
              toolbar={
                <>
                  <span className="text-muted-foreground tabular text-sm">
                    {t('results', { count: total })}
                  </span>
                  {selected.size > 0 && (
                    <Button size="sm" onClick={disavowSelected} disabled={add.isPending}>
                      <ShieldAlert aria-hidden /> {t('disavowSelected', { count: selected.size })}
                    </Button>
                  )}
                </>
              }
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">{t('caution')}</p>
            <Pagination
              page={Number(query.page)}
              pageSize={Number(query.pageSize)}
              total={total}
              onPage={(p) => set({ page: p })}
              onPageSize={(s) => set({ pageSize: s })}
            />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('listTitle')}</h2>
            </CardTitle>
            <CardDescription>{t('listHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button variant="outline" size="sm" asChild disabled={!disavow.data?.length}>
              <a href={disavowExportUrl(current.id)} download>
                <Download aria-hidden /> {t('download')}
              </a>
            </Button>
            {disavow.data?.length ? (
              <ul className="divide-border max-h-80 divide-y overflow-y-auto text-sm">
                {disavow.data.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-xs">
                        {e.type === 'domain' ? `domain:${e.value}` : e.value}
                      </span>
                      {e.reason && (
                        <span className="text-muted-foreground block truncate text-xs">
                          {e.reason}
                        </span>
                      )}
                    </span>
                    {editable && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => remove.mutate([e.id])}
                        aria-label={t('remove', { value: e.value })}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">{t('empty')}</p>
            )}
            {editable && (
              <form onSubmit={submitManual} className="space-y-2">
                <label className="block space-y-1.5 text-sm font-medium">
                  {t('manual')}
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={4}
                    placeholder={t('manualPlaceholder')}
                    className="border-input bg-background focus-visible:ring-ring/40 w-full rounded-md border px-3 py-2 font-mono text-xs font-normal outline-none focus-visible:ring-2"
                  />
                </label>
                <Button type="submit" size="sm" disabled={!text.trim() || add.isPending}>
                  {t('addManual')}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
