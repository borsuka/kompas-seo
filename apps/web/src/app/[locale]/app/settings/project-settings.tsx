'use client';
import { Target, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { normalizeDomain } from '@seo/shared';
import { Alert } from '@seo/ui/alert';
import { Badge } from '@seo/ui/badge';
import { Button } from '@seo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@seo/ui/card';
import { Input } from '@seo/ui/input';
import { toast } from '@seo/ui/sonner';
import { useCurrentProject } from '@/components/app-shell/project-context';
import { FormMessage } from '@/components/auth/auth-card';
import { ProjectForm } from '@/components/project-form';
import { EmptyState, ErrorState } from '@/components/states';
import {
  useAddCompetitor,
  useCan,
  useCompetitors,
  useCreateProject,
  useDeleteProject,
  useRemoveCompetitor,
  useUpdateProject,
} from '@/lib/queries';
import { useErrorMessage } from '@/lib/use-error-message';

export function ProjectSettings({ showNew }: { showNew: boolean }) {
  const t = useTranslations();
  const can = useCan();
  const errorMessage = useErrorMessage();
  const { current, select } = useCurrentProject();
  const update = useUpdateProject(current?.id ?? '');
  const create = useCreateProject();
  const remove = useDeleteProject();
  const readOnly = !can('project:update');

  if (!current) return null;

  return (
    <div className="space-y-6">
      {readOnly && <Alert variant="info">{t('common.readOnly')}</Alert>}

      {showNew && can('project:create') && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('shell.newProject')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ProjectForm
              submitLabel={t('onboarding.create')}
              pending={create.isPending}
              onSubmit={(values) =>
                create.mutate(values, {
                  onSuccess: (p) => {
                    select(p.id);
                    toast.success(t('common.saved'));
                  },
                  onError: (err) => toast.error(errorMessage(err)),
                })
              }
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t('settings.project.title')}</h2>
          </CardTitle>
          <CardDescription>{t('settings.project.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectForm
            key={current.id}
            initial={current}
            disabled={readOnly}
            submitLabel={t('common.save')}
            pending={update.isPending}
            onSubmit={(values) =>
              update.mutate(values, {
                onSuccess: () => toast.success(t('common.saved')),
                onError: (err) => toast.error(errorMessage(err)),
              })
            }
          />
        </CardContent>
      </Card>

      <CompetitorsCard projectId={current.id} readOnly={readOnly} />

      {can('project:delete') && (
        <div className="flex justify-end">
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => {
              if (!window.confirm(t('settings.project.deleteConfirm'))) return;
              remove.mutate(current.id, {
                onSuccess: () => toast.success(t('settings.project.deleted')),
                onError: (err) => toast.error(errorMessage(err)),
              });
            }}
          >
            <Trash2 aria-hidden /> {t('settings.project.deleteProject')}
          </Button>
        </div>
      )}
    </div>
  );
}

function CompetitorsCard({ projectId, readOnly }: { projectId: string; readOnly: boolean }) {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const competitors = useCompetitors(projectId);
  const add = useAddCompetitor(projectId);
  const removeCompetitor = useRemoveCompetitor(projectId);
  const [domain, setDomain] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeDomain(domain);
    if (!normalized) return setError(t('errors.VALIDATION_FAILED'));
    setError(null);
    try {
      await add.mutateAsync(normalized);
      setDomain('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('settings.project.competitorsTitle')}</h2>
        </CardTitle>
        <CardDescription>{t('settings.project.competitorsDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!readOnly && (
          <form onSubmit={onAdd} className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder={t('settings.project.competitorPlaceholder')}
              aria-label={t('settings.project.competitorsTitle')}
              inputMode="url"
            />
            <Button type="submit" disabled={!domain || add.isPending}>
              {t('common.add')}
            </Button>
          </form>
        )}
        {error && <FormMessage tone="error">{error}</FormMessage>}
        {competitors.error ? (
          <ErrorState error={competitors.error} onRetry={() => competitors.refetch()} />
        ) : competitors.data?.length === 0 ? (
          <EmptyState
            icon={Target}
            title={t('settings.project.competitorsTitle')}
            description={t('settings.project.noCompetitors')}
          />
        ) : (
          <ul className="divide-border border-border divide-y rounded-md border">
            {competitors.data?.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="truncate text-sm">{c.domain}</span>
                <span className="flex items-center gap-2">
                  <Badge variant="outline">
                    {c.source === 'auto'
                      ? t('settings.project.sourceAuto')
                      : t('settings.project.sourceManual')}
                  </Badge>
                  {!readOnly && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('common.remove')}
                      onClick={() => removeCompetitor.mutate(c.id)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
