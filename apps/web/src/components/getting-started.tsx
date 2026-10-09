'use client';
import { CheckCircle2, ChevronRight, Circle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@seo/ui/card';
import { cn } from '@seo/ui/cn';
import { Skeleton } from '@seo/ui/skeleton';
import { Link } from '@/i18n/navigation';
import { useGsc } from '@/lib/content-api';
import { useKeywordLists } from '@/lib/keywords-api';
import { useCompetitors, useMembers } from '@/lib/queries';
import { useRankingsSummary } from '@/lib/rankings-api';

type StepKey = 'project' | 'keywords' | 'competitors' | 'rankings' | 'gsc' | 'team';

const HREF: Record<StepKey, string> = {
  project: '/app/settings?tab=project',
  keywords: '/app/keywords',
  competitors: '/app/competitors',
  rankings: '/app/rankings/keywords',
  gsc: '/app/content/gsc',
  team: '/app/settings?tab=members',
};

/** Onboarding checklist derived from the project's real state (nothing is stored). */
export function GettingStarted({ projectId }: { projectId: string }) {
  const t = useTranslations('dashboard.gettingStarted');
  const lists = useKeywordLists();
  const competitors = useCompetitors(projectId);
  const ranks = useRankingsSummary(projectId, { days: '30' });
  const gsc = useGsc(projectId);
  const members = useMembers();

  const queries = [lists, competitors, ranks, gsc, members];
  const loading = queries.some((q) => q.isPending && !q.isError);
  const done: Record<StepKey, boolean> = {
    project: true,
    keywords: (lists.data?.length ?? 0) > 0,
    competitors: (competitors.data?.length ?? 0) > 0,
    rankings: (ranks.data?.keywords ?? 0) > 0,
    gsc: gsc.data?.status === 'active',
    team: (members.data?.length ?? 0) > 1,
  };
  const steps = Object.keys(HREF) as StepKey[];
  const completed = steps.filter((s) => done[s]).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('title')}</h2>
        </CardTitle>
        <CardDescription>
          {completed === steps.length
            ? t('allDone')
            : t('progress', { done: completed, total: steps.length })}
        </CardDescription>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={completed}
          aria-label={t('title')}
          className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full"
        >
          <div
            className="bg-primary h-full transition-[width] duration-300"
            style={{ width: `${(completed / steps.length) * 100}%` }}
          />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {steps.map((s) => (
              <Skeleton key={s} className="h-11" />
            ))}
          </div>
        ) : (
          <ul className="space-y-2">
            {steps.map((s) => (
              <li key={s}>
                <Link
                  href={HREF[s]}
                  className={cn(
                    'border-border hover:bg-muted focus-visible:ring-ring flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm focus-visible:ring-2 focus-visible:outline-none',
                    done[s] && 'text-muted-foreground',
                  )}
                >
                  {done[s] ? (
                    <CheckCircle2 className="text-success size-4 shrink-0" aria-hidden />
                  ) : (
                    <Circle className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  )}
                  <span className={cn('flex-1', done[s] && 'line-through')}>
                    {t(`steps.${s}`)}
                    <span className="sr-only"> ({done[s] ? t('stepDone') : t('stepTodo')})</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
