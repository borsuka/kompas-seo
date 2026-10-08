'use client';
import { Check, FolderPlus, Plus, Radar, Users } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { CompetitorDiscovery } from '@seo/shared';
import { Button } from '@seo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@seo/ui/card';
import { useCurrentProject } from '@/components/app-shell/project-context';
import { CompetitorsTabs } from '@/components/competitors/competitors-tabs';
import { DataTable, type DataColumn } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState } from '@/components/states';
import { Link } from '@/i18n/navigation';
import { useDiscoverCompetitors } from '@/lib/domains-api';
import { useAddCompetitor, useCan, useCompetitors } from '@/lib/queries';
import { useErrorMessage } from '@/lib/use-error-message';

type Candidate = CompetitorDiscovery['competitors'][number];

/** Hard cap of the keyword gap: target + 4 competitors. */
const GAP_MAX_COMPETITORS = 4;

export function DiscoverView() {
  const t = useTranslations('competitors');
  const format = useFormatter();
  const can = useCan();
  const errorMessage = useErrorMessage();
  const { current } = useCurrentProject();
  const [started, setStarted] = useState(false);
  const discovery = useDiscoverCompetitors(current?.id, started);
  const tracked = useCompetitors(current?.id);
  const add = useAddCompetitor(current?.id ?? '');
  const d = discovery.data;

  if (!current) {
    return (
      <>
        <PageHeader title={t('discover.title')} />
        <CompetitorsTabs />
        <EmptyState
          icon={FolderPlus}
          title={t('discover.noProject')}
          action={
            <Button asChild>
              <Link href="/onboarding">{t('discover.createProject')}</Link>
            </Button>
          }
        />
      </>
    );
  }

  const trackedDomains = (tracked.data ?? []).map((c) => c.domain);
  const gapHref = `/app/competitors/gap?target=${encodeURIComponent(current.domain)}&competitors=${encodeURIComponent(
    trackedDomains.slice(0, GAP_MAX_COMPETITORS).join(','),
  )}&loc=${current.locationCode}&lang=${current.languageCode}`;
  const overviewHref = (domain: string) =>
    `/app/competitors?domain=${encodeURIComponent(domain)}&loc=${current.locationCode}&lang=${current.languageCode}`;

  const columns: DataColumn<Candidate>[] = [
    {
      id: 'domain',
      label: t('columns.domain'),
      header: t('columns.domain'),
      primary: true,
      cell: (r) => (
        <Link
          href={overviewHref(r.domain)}
          className="hover:text-primary font-medium hover:underline"
        >
          {r.domain}
        </Link>
      ),
    },
    {
      id: 'level',
      label: t('columns.competitionLevel'),
      header: t('columns.competitionLevel'),
      metric: 'competitionLevel',
      cell: (r) => (
        <span className="flex items-center gap-2">
          <span className="bg-muted h-1.5 w-24 overflow-hidden rounded-full" aria-hidden>
            <span
              className="bg-primary block h-full rounded-full"
              style={{ width: `${Math.round(r.competitionLevel * 100)}%` }}
            />
          </span>
          <span className="tabular text-xs">
            {format.number(r.competitionLevel, { style: 'percent' })}
          </span>
        </span>
      ),
    },
    {
      id: 'common',
      label: t('columns.commonKeywords'),
      header: t('columns.commonKeywords'),
      align: 'right',
      cell: (r) => format.number(r.commonKeywords),
    },
    {
      id: 'keywords',
      label: t('columns.domainKeywords'),
      header: t('columns.domainKeywords'),
      align: 'right',
      hideable: true,
      cell: (r) => (r.domainKeywords === null ? '–' : format.number(r.domainKeywords)),
    },
    {
      id: 'actions',
      label: t('columns.actions'),
      header: <span className="sr-only">{t('columns.actions')}</span>,
      align: 'right',
      cell: (r) =>
        r.tracked || trackedDomains.includes(r.domain) ? (
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            <Check className="size-3.5" aria-hidden /> {t('discover.tracked')}
          </span>
        ) : can('project:update') ? (
          <Button
            size="sm"
            variant="outline"
            disabled={add.isPending}
            onClick={() => add.mutate({ domain: r.domain, source: 'auto' })}
            aria-label={t('discover.trackDomain', { domain: r.domain })}
          >
            <Plus aria-hidden /> {t('discover.track')}
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('discover.title')}
        description={t('discover.description', { domain: current.domain })}
        actions={
          trackedDomains.length > 0 && (
            <Button variant="outline" size="sm" asChild>
              <Link href={gapHref}>{t('discover.openGap')}</Link>
            </Button>
          )
        }
      />
      <CompetitorsTabs />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {!started ? (
            <EmptyState
              icon={Radar}
              title={t('discover.startTitle')}
              description={t('discover.startBody')}
              action={
                can('research:run') ? (
                  <Button onClick={() => setStarted(true)}>
                    <Radar aria-hidden /> {t('discover.start')}
                  </Button>
                ) : (
                  <p className="text-muted-foreground text-sm">{t('discover.viewerHint')}</p>
                )
              }
            />
          ) : discovery.error ? (
            <ErrorState error={discovery.error} onRetry={() => discovery.refetch()} />
          ) : (
            <>
              <DataTable
                columns={columns}
                rows={d?.competitors ?? []}
                rowId={(r) => r.domain}
                caption={t('discover.title')}
                loading={discovery.isFetching}
                storageKey="discover"
                empty={<EmptyState icon={Radar} title={t('discover.none')} />}
                toolbar={
                  d && (
                    <span className="text-muted-foreground text-sm">
                      {t('discover.analyzed', { count: d.keywordsAnalyzed })}
                      {d.creditsCharged > 0 &&
                        ` · ${t('creditsSpent', { count: d.creditsCharged })}`}
                    </span>
                  )
                }
              />
              {add.error && (
                <p className="text-destructive text-sm" role="alert">
                  {errorMessage(add.error)}
                </p>
              )}
            </>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('discover.trackedTitle')}</h2>
            </CardTitle>
            <CardDescription>{t('discover.trackedBody')}</CardDescription>
          </CardHeader>
          <CardContent>
            {trackedDomains.length === 0 ? (
              <p className="text-muted-foreground flex items-center gap-2 text-sm">
                <Users className="size-4" aria-hidden /> {t('discover.noTracked')}
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {tracked.data?.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2">
                    <Link href={overviewHref(c.domain)} className="truncate hover:underline">
                      {c.domain}
                    </Link>
                    <span className="text-muted-foreground text-xs">
                      {t(`discover.source.${c.source}`)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Button variant="link" size="sm" className="mt-3 px-0" asChild>
              <Link href="/app/settings">{t('discover.manage')}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
