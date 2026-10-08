'use client';
import { Link2, SearchX } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { ANCHOR_TYPES, type AnchorRowDto } from '@seo/shared';
import { BacklinksTabs } from '@/components/backlinks/backlinks-tabs';
import { DomainBar, useDomainParams } from '@/components/competitors/domain-bar';
import { Segmented } from '@/components/competitors/segmented';
import { DataTable, Pagination, type DataColumn } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState } from '@/components/states';
import { useAnchors } from '@/lib/backlinks-api';

export function AnchorsView() {
  const t = useTranslations('backlinks');
  const format = useFormatter();
  const { domain, params, set } = useDomainParams();
  const type = (params.type ?? 'all') as 'all' | (typeof ANCHOR_TYPES)[number];
  const query = {
    target: domain || undefined,
    type: type === 'all' ? undefined : type,
    page: params.page ?? '1',
    pageSize: params.pageSize ?? '50',
  };
  const anchors = useAnchors(query);
  const data = anchors.data;

  const columns: DataColumn<AnchorRowDto>[] = [
    {
      id: 'anchor',
      label: t('columns.anchor'),
      header: t('columns.anchor'),
      primary: true,
      cell: (r) => (
        <span className="font-medium">
          {r.anchor || <span className="text-muted-foreground">{t('anchors.empty')}</span>}
        </span>
      ),
    },
    {
      id: 'type',
      label: t('columns.type'),
      header: t('columns.type'),
      cell: (r) => t(`anchorTypes.${r.type}`),
    },
    {
      id: 'domains',
      label: t('columns.referringDomains'),
      header: t('columns.referringDomains'),
      align: 'right',
      cell: (r) => format.number(r.referringDomains),
    },
    {
      id: 'backlinks',
      label: t('columns.backlinks'),
      header: t('columns.backlinks'),
      align: 'right',
      cell: (r) => format.number(r.backlinks),
    },
    {
      id: 'dofollow',
      label: t('columns.dofollow'),
      header: t('columns.dofollow'),
      align: 'right',
      cell: (r) => format.number(r.backlinks ? r.dofollow / r.backlinks : 0, { style: 'percent' }),
    },
  ];

  const total = data?.total ?? 0;
  return (
    <>
      <PageHeader title={domain || t('title')} description={t('anchors.description')} />
      <BacklinksTabs />
      <DomainBar key={domain} showLocale={false} />
      {!domain ? (
        <EmptyState icon={Link2} title={t('emptyTitle')} description={t('emptyBody')} />
      ) : anchors.error ? (
        <ErrorState error={anchors.error} onRetry={() => anchors.refetch()} />
      ) : (
        <div className="space-y-3">
          <Segmented
            label={t('columns.type')}
            value={type}
            onChange={(v) => set({ type: v === 'all' ? null : v })}
            options={(['all', ...ANCHOR_TYPES] as const).map((v) => ({
              value: v,
              label: v === 'all' ? t('anchors.all') : t(`anchorTypes.${v}`),
            }))}
          />
          <p className="text-muted-foreground text-sm">{t('anchors.hint')}</p>
          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            rowId={(r) => r.anchor}
            caption={t('anchors.results', { count: total })}
            loading={anchors.isFetching}
            storageKey="anchors"
            empty={<EmptyState icon={SearchX} title={t('noResults')} />}
            toolbar={
              <span className="text-muted-foreground tabular text-sm">
                {t('anchors.results', { count: total })}
              </span>
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
