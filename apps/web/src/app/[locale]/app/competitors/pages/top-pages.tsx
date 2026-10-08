'use client';
import { FileText, Globe } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { TopPage } from '@seo/shared';
import { CompetitorsTabs } from '@/components/competitors/competitors-tabs';
import { DomainBar, useDomainParams } from '@/components/competitors/domain-bar';
import { UrlCell } from '@/components/competitors/position';
import { DataTable, Pagination, type DataColumn } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState } from '@/components/states';
import { Link } from '@/i18n/navigation';
import { useDomainPages } from '@/lib/domains-api';

export function TopPagesView() {
  const t = useTranslations('competitors');
  const format = useFormatter();
  const { domain, loc, lang, params, set } = useDomainParams();
  const query = {
    domain: domain || undefined,
    loc: String(loc),
    lang,
    page: params.page ?? '1',
    pageSize: params.pageSize ?? '50',
  };
  const result = useDomainPages(query);
  const data = result.data;

  const keywordsHref = (url: string) =>
    `/app/competitors/keywords?domain=${encodeURIComponent(domain)}&loc=${loc}&lang=${lang}&url=${encodeURIComponent(url)}`;

  const columns: DataColumn<TopPage>[] = [
    {
      id: 'url',
      label: t('columns.url'),
      header: t('columns.url'),
      primary: true,
      cell: (r) => <UrlCell url={r.url} />,
    },
    {
      id: 'traffic',
      label: t('columns.traffic'),
      header: t('columns.traffic'),
      metric: 'traffic',
      align: 'right',
      cell: (r) => format.number(Math.round(r.traffic)),
    },
    {
      id: 'keywords',
      label: t('columns.keywords'),
      header: t('columns.keywords'),
      align: 'right',
      cell: (r) => (
        <Link href={keywordsHref(r.url)} className="tabular text-primary hover:underline">
          {format.number(r.keywords)}
        </Link>
      ),
    },
    {
      id: 'topKeyword',
      label: t('columns.topKeyword'),
      header: t('columns.topKeyword'),
      hideable: true,
      cell: (r) => (
        <span className="text-sm">
          {r.topKeyword}{' '}
          <span className="text-muted-foreground tabular text-xs">
            {t('pagesPage.topKeywordMeta', {
              position: r.topKeywordPosition,
              volume: format.number(r.topKeywordVolume),
            })}
          </span>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={domain || t('title')} description={t('pagesPage.description')} />
      <CompetitorsTabs />
      <DomainBar key={domain} />
      {!domain ? (
        <EmptyState icon={Globe} title={t('emptyTitle')} description={t('emptyBody')} />
      ) : result.error ? (
        <ErrorState error={result.error} onRetry={() => result.refetch()} />
      ) : (
        <div className="space-y-3">
          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            rowId={(r) => r.url}
            caption={t('pagesPage.results', { count: data?.total ?? 0 })}
            loading={result.isFetching}
            storageKey="domain-pages"
            empty={<EmptyState icon={FileText} title={t('pagesPage.empty')} />}
            toolbar={
              <span className="text-muted-foreground tabular text-sm">
                {t('pagesPage.results', { count: data?.total ?? 0 })}
              </span>
            }
          />
          <div className="flex justify-end">
            <Pagination
              page={Number(query.page)}
              pageSize={Number(query.pageSize)}
              total={data?.total ?? 0}
              onPage={(p) => set({ page: p })}
              onPageSize={(s) => set({ pageSize: s })}
            />
          </div>
        </div>
      )}
    </>
  );
}
