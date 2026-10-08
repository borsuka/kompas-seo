'use client';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@seo/ui/button';
import { toast } from '@seo/ui/sonner';
import { rk, useCheckRankings } from '@/lib/rankings-api';
import { useCan } from '@/lib/queries';
import { useErrorMessage } from '@/lib/use-error-message';
import { useJobProgress } from '@/lib/use-job-progress';

/** Last check time + manual re-check that follows the background job live. */
export function CheckNow({
  projectId,
  lastCheckedAt,
  keywords,
  initialJobId = null,
}: {
  projectId: string;
  lastCheckedAt: string | null;
  keywords: number;
  /** A job started elsewhere (e.g. the first check after adding keywords). */
  initialJobId?: string | null;
}) {
  const t = useTranslations('rankings');
  const format = useFormatter();
  const can = useCan();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const check = useCheckRankings(projectId);
  const [jobId, setJobId] = useState<string | null>(initialJobId);
  const job = useJobProgress(jobId);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follow a job started by the parent
    if (initialJobId) setJobId(initialJobId);
  }, [initialJobId]);

  useEffect(() => {
    if (job?.status === 'completed') {
      toast.success(t('checkDone'));
      void qc.invalidateQueries({ queryKey: rk.all(projectId) });
      // eslint-disable-next-line react-hooks/set-state-in-effect -- job finished: stop following it
      setJobId(null);
    } else if (job?.status === 'failed') {
      toast.error(job.error ?? t('checkFailed'));
      setJobId(null);
    }
  }, [job?.status, job?.error, projectId, qc, t]);

  const running = !!jobId;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-muted-foreground text-xs">
        {running
          ? t('checking', { progress: Math.round(job?.progress ?? 0) })
          : lastCheckedAt
            ? t('lastChecked', {
                date: format.dateTime(new Date(lastCheckedAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              })
            : t('neverChecked')}
      </span>
      {can('rankTracking:update') && can('research:run') && (
        <Button
          variant="outline"
          size="sm"
          disabled={running || check.isPending || keywords === 0}
          title={t('checkCost', { count: keywords })}
          onClick={async () => {
            try {
              const started = await check.mutateAsync();
              setJobId(started.id);
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        >
          <RefreshCw className={running ? 'animate-spin' : undefined} aria-hidden /> {t('checkNow')}
        </Button>
      )}
    </div>
  );
}
