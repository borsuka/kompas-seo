'use client';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, Download, Loader2, Trash2 } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Badge } from '@seo/ui/badge';
import { Button } from '@seo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@seo/ui/card';
import { Skeleton } from '@seo/ui/skeleton';
import { toast } from '@seo/ui/sonner';
import { BriefStatus, ContentTabs } from '@/components/content/content-tabs';
import { UrlCell } from '@/components/competitors/position';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/states';
import { Link, useRouter } from '@/i18n/navigation';
import { briefExportUrl, ck, useBrief, useDeleteBrief } from '@/lib/content-api';
import { useCan } from '@/lib/queries';
import { useJobProgress } from '@/lib/use-job-progress';

export function BriefDetail({ id }: { id: string }) {
  const t = useTranslations('content.detail');
  const ts = useTranslations('content');
  const format = useFormatter();
  const ui = useLocale();
  const can = useCan();
  const router = useRouter();
  const qc = useQueryClient();
  const brief = useBrief(id);
  const remove = useDeleteBrief();
  const b = brief.data;
  const running = !!b && (b.status === 'queued' || b.status === 'running');
  const job = useJobProgress(running ? b.jobId : null);

  useEffect(() => {
    if (job?.status === 'completed' || job?.status === 'failed')
      void qc.invalidateQueries({ queryKey: ck.brief(id) });
  }, [job?.status, id, qc]);

  if (brief.error) return <ErrorState error={brief.error} onRetry={() => brief.refetch()} />;
  if (!b) return <Skeleton className="h-96" />;

  const c = b.brief;
  const a = b.analysis;
  const copy = async () => {
    const res = await fetch(briefExportUrl(id, ui));
    await navigator.clipboard.writeText(await res.text());
    toast.success(t('copied'));
  };

  return (
    <>
      <PageHeader
        title={b.keyword}
        description={t('description')}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/app/content">
                <ArrowLeft aria-hidden /> {t('back')}
              </Link>
            </Button>
            {c && (
              <>
                <Button variant="outline" size="sm" onClick={copy}>
                  <Copy aria-hidden /> {t('copy')}
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href={briefExportUrl(id, ui)} download>
                    <Download aria-hidden /> {t('download')}
                  </a>
                </Button>
              </>
            )}
            {can('report:create') && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('delete')}
                onClick={async () => {
                  if (!window.confirm(t('confirmDelete'))) return;
                  await remove.mutateAsync(id);
                  router.push('/app/content');
                }}
              >
                <Trash2 aria-hidden />
              </Button>
            )}
          </>
        }
      />
      <ContentTabs />

      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <BriefStatus status={b.status} />
        {b.source && <span className="text-muted-foreground">{ts(`source.${b.source}`)}</span>}
        <span className="text-muted-foreground">
          {format.dateTime(new Date(b.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
        </span>
      </div>

      {running ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-10">
            <Loader2 className="text-primary size-5 animate-spin" aria-hidden />
            <div>
              <p className="font-medium">{t('working')}</p>
              <p className="text-muted-foreground text-sm">
                {t('progress', { progress: Math.round(job?.progress ?? 0) })} · {t('workingHint')}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : b.status === 'failed' ? (
        <ErrorState error={new Error(b.error ?? t('failed'))} />
      ) : c && a ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>{t('basics')}</h2>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
                    {t('titles')}
                  </p>
                  <ul className="list-disc space-y-1 pl-5">
                    {c.titleOptions.map((x) => (
                      <li key={x}>
                        {x}{' '}
                        <span className="text-muted-foreground tabular text-xs">({x.length})</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
                    {t('meta')}
                  </p>
                  <p>
                    {c.metaDescription}{' '}
                    <span className="text-muted-foreground tabular text-xs">
                      ({c.metaDescription.length})
                    </span>
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
                      {t('h1')}
                    </p>
                    <p className="font-medium">{c.h1}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
                      {t('intent')}
                    </p>
                    <p>{c.searchIntent}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
                      {t('length')}
                    </p>
                    <p className="tabular">
                      {t('words', {
                        min: format.number(c.wordCount.min),
                        max: format.number(c.wordCount.max),
                      })}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>{t('outline')}</h2>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-3 text-sm">
                  {c.outline.map((o, i) => (
                    <li
                      key={`${o.heading}-${i}`}
                      className={o.level === 3 ? 'border-border ml-6 border-l pl-3' : ''}
                    >
                      <p className={o.level === 2 ? 'font-semibold' : 'font-medium'}>
                        <span className="text-muted-foreground mr-2 text-xs">H{o.level}</span>
                        {o.heading}
                      </p>
                      {o.points.length > 0 && (
                        <ul className="text-muted-foreground mt-1 list-disc space-y-0.5 pl-5">
                          {o.points.map((p) => (
                            <li key={p}>{p}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>

            {c.questions.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <h2>{t('questions')}</h2>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {c.questions.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>{t('top10')}</h2>
                </CardTitle>
                <CardDescription>{t('top10Hint', { count: a.pagesAnalyzed })}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  {t('stats.words', {
                    median: format.number(a.wordCount.median),
                    p25: format.number(a.wordCount.p25),
                    p75: format.number(a.wordCount.p75),
                  })}
                </p>
                <p>{t('stats.headings', { h2: a.headings.medianH2, h3: a.headings.medianH3 })}</p>
                <p>
                  {t('stats.keywordInTitle', {
                    share: format.number(a.keywordInTitle, { style: 'percent' }),
                  })}
                </p>
                {a.schemaTypes.length > 0 && (
                  <p>
                    {t('stats.schema', {
                      types: a.schemaTypes
                        .slice(0, 4)
                        .map((s) => s.type)
                        .join(', '),
                    })}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>{t('terms')}</h2>
                </CardTitle>
                <CardDescription>{t('termsHint')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {(a.terms.length ? a.terms : c.keyTerms.map((term) => ({ term, coverage: null })))
                    .slice(0, 30)
                    .map((x) => (
                      <Badge key={x.term} variant="outline" className="font-normal">
                        {x.term}
                        {x.coverage !== null && (
                          <span className="text-muted-foreground tabular ml-1">
                            {format.number(x.coverage, { style: 'percent' })}
                          </span>
                        )}
                      </Badge>
                    ))}
                </div>
              </CardContent>
            </Card>

            {c.notes.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <h2>{t('notes')}</h2>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {c.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>{t('pages')}</h2>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2 text-sm">
                  {b.pages.map((p) => (
                    <li key={p.url} className="flex gap-2">
                      <span className="text-muted-foreground tabular w-5 shrink-0 text-right">
                        {p.position}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {p.title ?? new URL(p.url).hostname}
                        </span>
                        <UrlCell url={p.url} />
                        {p.skipped ? (
                          <span className="text-xs text-amber-700 dark:text-amber-300">
                            {t(`skipped.${p.skipped}`)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground tabular text-xs">
                            {t('pageWords', { count: p.wordCount })}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}
