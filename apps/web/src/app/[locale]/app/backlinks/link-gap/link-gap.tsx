'use client';
import { GitCompare, SearchX } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { LinkGapRowDto } from '@seo/shared';
import { BacklinksTabs } from '@/components/backlinks/backlinks-tabs';
import { Rating } from '@/components/backlinks/badges';
import { GapForm, useGapParams } from '@/components/competitors/gap-form';
import { Segmented } from '@/components/competitors/segmented';
import { DataTable, Pagination, type DataColumn } from '@/components/data-table';
import { ExportMenu } from '@/components/keywords/export-menu';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState } from '@/components/states';
import { Link } from '@/i18n/navigation';
import { useLinkGap } from '@/lib/backlinks-api';

export function LinkGapView() {
  const t = useTranslations('backlinks');
  const format = useFormatter();
  const { target, competitors, confirmed, params, set } = useGapParams();
  const min = params.minCompetitors ?? '1';
  const hideToxic = params.hideToxic ?? 'true';
  const query = {
    target: confirmed ? target : undefined,
    competitors: confirmed ? competitors.join(',') : undefined,
    minCompetitors: min,
    hideToxic,
    page: params.page ?? '1',
    pageSize: params.pageSize ?? '50',
  };
  const gap = useLinkGap(query);
  const data = gap.data;
  const domains = data?.domains ?? [target, ...competitors];

  const columns: DataColumn<LinkGapRowDto>[] = [
    {
      id: 'domain',
      label: t('columns.domain'),
      header: t('columns.domain'),
      primary: true,
      cell: (r) => (
        <Link
          href={`/app/backlinks?domain=${encodeURIComponent(r.domain)}`}
          className="hover:text-primary font-medium hover:underline"
        >
          {r.domain}
        </Link>
      ),
    },
    {
      id: 'rating',
      label: t('columns.rating'),
      header: t('columns.rating'),
      metric: 'domainRating',
      align: 'right',
      cell: (r) => <Rating value={r.rating} />,
    },
    {
      id: 'competitors',
      label: t('columns.competitors'),
      header: t('columns.competitors'),
      align: 'right',
      cell: (r) => format.number(r.competitors),
    },
    ...domains.map((d, i): DataColumn<LinkGapRowDto> => ({
      id: `links-${d}`,
      label: d,
      header: (
        <span
          className={
            i === 0
              ? 'text-primary block max-w-28 truncate font-semibold'
              : 'block max-w-28 truncate'
          }
          title={d}
        >
          {d}
        </span>
      ),
      align: 'right',
      cell: (r) => {
        const n = r.links[d] ?? 0;
        return n ? (
          <span className="tabular">{format.number(n)}</span>
        ) : (
          <span className="text-muted-foreground">–</span>
        );
      },
    })),
  ];

  const total = data?.total ?? 0;
  return (
    <>
      <PageHeader title={t('linkGap.title')} description={t('linkGap.description')} />
      <BacklinksTabs />
      <GapForm key={`${target}|${competitors.join(',')}`} showLocale={false} />
      {!confirmed ? (
        <EmptyState
          icon={GitCompare}
          title={t('linkGap.emptyTitle')}
          description={t('linkGap.emptyBody')}
        />
      ) : gap.error ? (
        <ErrorState error={gap.error} onRetry={() => gap.refetch()} />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              label={t('linkGap.min')}
              value={min}
              onChange={(v) => set({ minCompetitors: v === '1' ? null : v })}
              options={Array.from({ length: Math.max(1, competitors.length) }, (_, i) =>
                String(i + 1),
              ).map((v) => ({
                value: v,
                label: t('linkGap.minOption', { count: Number(v) }),
              }))}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-primary)]"
                checked={hideToxic === 'true'}
                onChange={(e) => set({ hideToxic: e.target.checked ? null : 'false' })}
              />
              {t('linkGap.hideToxic')}
            </label>
          </div>
          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            rowId={(r) => r.domain}
            caption={t('linkGap.results', { count: total })}
            loading={gap.isFetching}
            storageKey="link-gap"
            empty={<EmptyState icon={SearchX} title={t('linkGap.none')} />}
            toolbar={
              <>
                <span className="text-muted-foreground tabular text-sm">
                  {t('linkGap.results', { count: total })}
                </span>
                <ExportMenu path="/backlinks/link-gap/export" params={query} />
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
