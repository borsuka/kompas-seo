'use client';
import { FileText, Sparkles } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { findLocation, type BriefListItem } from '@seo/shared';
import { Button } from '@seo/ui/button';
import { Input } from '@seo/ui/input';
import { toast } from '@seo/ui/sonner';
import { useCurrentProject } from '@/components/app-shell/project-context';
import { BriefStatus, ContentTabs } from '@/components/content/content-tabs';
import { DataTable, Pagination, type DataColumn } from '@/components/data-table';
import { LocalePicker } from '@/components/keywords/locale-picker';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState } from '@/components/states';
import { Link, useRouter } from '@/i18n/navigation';
import { useBriefs, useCreateBrief } from '@/lib/content-api';
import { useCan } from '@/lib/queries';
import { useErrorMessage } from '@/lib/use-error-message';
import { useSearchState } from '@/lib/use-search-state';

export function BriefsList() {
  const t = useTranslations('content');
  const tc = useTranslations('countries');
  const format = useFormatter();
  const can = useCan();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const { current } = useCurrentProject();
  const { params, set } = useSearchState();
  const [keyword, setKeyword] = useState(params.q ?? '');
  const [loc, setLoc] = useState(current?.locationCode ?? 2100);
  const [lang, setLang] = useState(current?.languageCode ?? 'bg');
  const query = { page: params.page ?? '1', pageSize: '20' };
  const briefs = useBriefs(query);
  const create = useCreateBrief();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!keyword.trim()) return;
    try {
      const brief = await create.mutateAsync({
        keyword: keyword.trim(),
        loc,
        lang: lang as 'bg',
        projectId: current?.id,
      });
      router.push(`/app/content/briefs/${brief.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const columns: DataColumn<BriefListItem>[] = [
    {
      id: 'keyword',
      label: t('columns.keyword'),
      header: t('columns.keyword'),
      primary: true,
      cell: (r) => (
        <Link
          href={`/app/content/briefs/${r.id}`}
          className="hover:text-primary font-medium hover:underline"
        >
          {r.keyword}
        </Link>
      ),
    },
    {
      id: 'market',
      label: t('columns.market'),
      header: t('columns.market'),
      cell: (r) => {
        const iso = findLocation(r.locationCode)?.iso;
        return `${iso ? tc(iso) : r.locationCode} · ${r.languageCode.toUpperCase()}`;
      },
    },
    {
      id: 'status',
      label: t('columns.status'),
      header: t('columns.status'),
      cell: (r) => <BriefStatus status={r.status} />,
    },
    {
      id: 'source',
      label: t('columns.source'),
      header: t('columns.source'),
      hideable: true,
      cell: (r) => (r.source ? t(`source.${r.source}`) : '–'),
    },
    {
      id: 'created',
      label: t('columns.created'),
      header: t('columns.created'),
      align: 'right',
      cell: (r) =>
        format.dateTime(new Date(r.createdAt), { dateStyle: 'medium', timeStyle: 'short' }),
    },
  ];

  const total = briefs.data?.total ?? 0;
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <ContentTabs />
      {can('report:create') && can('research:run') && (
        <form onSubmit={submit} className="mb-6 flex flex-col gap-2 lg:flex-row">
          <div className="relative flex-1">
            <Sparkles
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={t('form.placeholder')}
              aria-label={t('form.keyword')}
              className="h-10 pl-9"
            />
          </div>
          <LocalePicker
            loc={loc}
            lang={lang}
            onChange={(l, lg) => {
              setLoc(l);
              setLang(lg);
            }}
          />
          <Button
            type="submit"
            className="h-10"
            disabled={!keyword.trim() || create.isPending}
            title={t('form.cost')}
          >
            {t('form.submit')}
          </Button>
        </form>
      )}
      {briefs.error ? (
        <ErrorState error={briefs.error} onRetry={() => briefs.refetch()} />
      ) : (
        <div className="space-y-3">
          <DataTable
            columns={columns}
            rows={briefs.data?.items ?? []}
            rowId={(r) => r.id}
            caption={t('list')}
            loading={briefs.isFetching && !briefs.data}
            storageKey="briefs"
            empty={
              <EmptyState icon={FileText} title={t('emptyTitle')} description={t('emptyBody')} />
            }
            toolbar={
              <span className="text-muted-foreground tabular text-sm">
                {t('results', { count: total })}
              </span>
            }
          />
          <div className="flex justify-end">
            <Pagination
              page={Number(query.page)}
              pageSize={20}
              total={total}
              onPage={(p) => set({ page: p })}
            />
          </div>
        </div>
      )}
    </>
  );
}
