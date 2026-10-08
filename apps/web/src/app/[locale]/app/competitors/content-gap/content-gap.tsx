'use client';
import { FileSearch, Lightbulb } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { ContentGapResponse } from '@seo/shared';
import { CompetitorsTabs } from '@/components/competitors/competitors-tabs';
import { GapForm, useGapParams } from '@/components/competitors/gap-form';
import { UrlCell } from '@/components/competitors/position';
import { DataTable, type DataColumn } from '@/components/data-table';
import { AddToListDialog } from '@/components/keywords/add-to-list-dialog';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState } from '@/components/states';
import { Link } from '@/i18n/navigation';
import { useContentGap } from '@/lib/domains-api';
import { useCan } from '@/lib/queries';

type Topic = ContentGapResponse['topics'][number];

export function ContentGapView() {
  const t = useTranslations('competitors');
  const format = useFormatter();
  const can = useCan();
  const { target, competitors, loc, lang, confirmed } = useGapParams();
  const gap = useContentGap({
    target: confirmed ? target : undefined,
    competitors: confirmed ? competitors.join(',') : undefined,
    loc: String(loc),
    lang,
  });
  const data = gap.data;

  const columns: DataColumn<Topic>[] = [
    {
      id: 'topic',
      label: t('contentGap.topic'),
      header: t('contentGap.topic'),
      primary: true,
      cell: (r) => (
        <Link
          href={`/app/keywords?q=${encodeURIComponent(r.topic)}&loc=${loc}&lang=${lang}`}
          className="hover:text-primary font-medium hover:underline"
        >
          {r.topic}
        </Link>
      ),
    },
    {
      id: 'competitors',
      label: t('contentGap.competitors'),
      header: t('contentGap.competitors'),
      align: 'right',
      cell: (r) => format.number(r.competitors),
    },
    {
      id: 'keywords',
      label: t('columns.keywords'),
      header: t('columns.keywords'),
      align: 'right',
      cell: (r) => format.number(r.keywords),
    },
    {
      id: 'volume',
      label: t('columns.volume'),
      header: t('columns.volume'),
      metric: 'volume',
      align: 'right',
      cell: (r) => format.number(r.totalVolume),
    },
    {
      id: 'traffic',
      label: t('columns.traffic'),
      header: t('columns.traffic'),
      metric: 'traffic',
      align: 'right',
      cell: (r) => format.number(Math.round(r.totalTraffic)),
    },
    {
      id: 'pages',
      label: t('contentGap.pages'),
      header: t('contentGap.pages'),
      hideable: true,
      cell: (r) => (
        <ul className="space-y-0.5">
          {r.pages.slice(0, 3).map((p) => (
            <li key={p.url} className="flex items-center gap-2">
              <span className="text-xs font-medium">{p.domain}</span>
              <UrlCell url={p.url} />
            </li>
          ))}
        </ul>
      ),
    },
  ];

  const topics = data?.topics ?? [];
  return (
    <>
      <PageHeader title={t('contentGap.title')} description={t('contentGap.description')} />
      <CompetitorsTabs />
      <GapForm key={`${target}|${competitors.join(',')}`} />
      {!confirmed ? (
        <EmptyState
          icon={Lightbulb}
          title={t('gap.emptyTitle')}
          description={t('contentGap.emptyBody')}
        />
      ) : gap.error ? (
        <ErrorState error={gap.error} onRetry={() => gap.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={topics}
          rowId={(r) => r.topic}
          caption={t('contentGap.results', { count: topics.length })}
          loading={gap.isFetching}
          storageKey="content-gap"
          empty={<EmptyState icon={FileSearch} title={t('contentGap.none')} />}
          toolbar={
            <>
              <span className="text-muted-foreground tabular text-sm">
                {t('contentGap.results', { count: topics.length })}
                {data &&
                  data.creditsCharged > 0 &&
                  ` · ${t('creditsSpent', { count: data.creditsCharged })}`}
              </span>
              {can('keywordList:update') && topics.length > 0 && (
                <AddToListDialog
                  keywords={topics.map((r) => r.topic)}
                  locationCode={loc}
                  languageCode={lang}
                  defaultName={t('contentGap.listName', { domain: target })}
                  label={t('contentGap.addTopics', { count: topics.length })}
                />
              )}
            </>
          }
        />
      )}
    </>
  );
}
