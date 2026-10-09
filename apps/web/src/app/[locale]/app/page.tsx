'use client';
import { CheckCircle2, Coins, FolderGit2, Target } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { findLocation } from '@seo/shared';
import { Badge } from '@seo/ui/badge';
import { Button } from '@seo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@seo/ui/card';
import { useCurrentProject } from '@/components/app-shell/project-context';
import { GettingStarted } from '@/components/getting-started';
import { MetricLabel } from '@/components/metric-tooltip';
import { PageHeader } from '@/components/page-header';
import { useCan, useCompetitors, useCredits, useMe, useStartDemoJob } from '@/lib/queries';
import { useJobProgress } from '@/lib/use-job-progress';
import { useErrorMessage } from '@/lib/use-error-message';

export default function DashboardPage() {
  const t = useTranslations();
  const format = useFormatter();
  const me = useMe();
  const { current } = useCurrentProject();
  const credits = useCredits();
  const competitors = useCompetitors(current?.id);
  const location = current ? findLocation(current.locationCode) : undefined;

  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.welcome', { name: me.data?.user.name ?? '' })}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <FolderGit2 className="size-4" aria-hidden /> {t('dashboard.projectCard')}
            </CardDescription>
            <CardTitle className="truncate text-lg">{current?.domain}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {location && <Badge variant="outline">{t(`countries.${location.iso}`)}</Badge>}
            {current && (
              <Badge variant="outline">
                {t(`languages.${current.languageCode}` as 'languages.bg')}
              </Badge>
            )}
            {current && <Badge variant="outline">{t(`devices.${current.device}`)}</Badge>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <Coins className="size-4" aria-hidden />
              <MetricLabel metric="credits" label={t('dashboard.creditsCard')} />
            </CardDescription>
            <CardTitle className="tabular text-2xl">
              {credits.data ? format.number(credits.data.balance) : '–'}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            {credits.data &&
              t('dashboard.creditsOf', { total: format.number(credits.data.monthlyCredits) })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <Target className="size-4" aria-hidden /> {t('dashboard.competitorsCard')}
            </CardDescription>
            <CardTitle className="tabular text-2xl">{competitors.data?.length ?? '–'}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            {t('dashboard.competitorsCount', { count: competitors.data?.length ?? 0 })}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {current && <GettingStarted projectId={current.id} />}
        <SystemCheckCard />
      </div>
    </>
  );
}

/** Starts a demo background job and streams its progress (verifies worker + SSE). */
function SystemCheckCard() {
  const t = useTranslations('dashboard');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const start = useStartDemoJob();
  const [jobId, setJobId] = useState<string | null>(null);
  const event = useJobProgress(jobId);
  const progress = Math.round(event?.progress ?? 0);
  const running = !!jobId && event?.status !== 'completed' && event?.status !== 'failed';

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('systemCheck')}</h2>
        </CardTitle>
        <CardDescription>{t('systemCheckBody')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label={t('systemCheck')}
          className="bg-muted h-2 overflow-hidden rounded-full"
        >
          <div
            className="bg-primary h-full transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-muted-foreground min-h-5 text-sm" aria-live="polite">
          {event?.status === 'completed' && (
            <span className="text-success inline-flex items-center gap-1">
              <CheckCircle2 className="size-4" aria-hidden /> {t('jobDone')}
            </span>
          )}
          {event?.status === 'failed' && t('jobFailed', { error: event.error ?? '' })}
          {event?.status === 'running' && t('jobRunning', { progress })}
          {event?.status === 'queued' && t('jobQueued')}
          {start.error && errorMessage(start.error)}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={running || start.isPending || !can('job:create')}
          onClick={async () => {
            const job = await start.mutateAsync();
            setJobId(job.id);
          }}
        >
          {t('runCheck')}
        </Button>
      </CardContent>
    </Card>
  );
}
