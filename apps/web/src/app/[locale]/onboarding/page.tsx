'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@seo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@seo/ui/card';
import { Input } from '@seo/ui/input';
import { FormField, FormMessage } from '@/components/auth/auth-card';
import { ProjectForm } from '@/components/project-form';
import { PublicHeader } from '@/components/public-header';
import { PageSkeleton } from '@/components/states';
import { useRouter } from '@/i18n/navigation';
import { useCreateOrganization, useCreateProject, useMe, useProjects } from '@/lib/queries';
import { useErrorMessage } from '@/lib/use-error-message';

export default function OnboardingPage() {
  const t = useTranslations('onboarding');
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const me = useMe();
  const hasOrg = !!me.data?.activeOrganization;
  const projects = useProjects(hasOrg);
  const createOrg = useCreateOrganization();
  const createProject = useCreateProject();
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (projects.data && projects.data.length > 0) router.replace('/app');
  }, [projects.data, router]);

  if (me.isPending || (hasOrg && projects.isPending)) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <PageSkeleton rows={2} />
      </div>
    );
  }

  async function submitOrg(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createOrg.mutateAsync(orgName.trim());
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const step = hasOrg ? 2 : 1;

  return (
    <div className="bg-muted/40 flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        <h1 className="mb-2 text-2xl font-semibold">{t('title')}</h1>
        <ol className="mb-6 flex list-inside list-decimal gap-6 text-sm" aria-label={t('title')}>
          <li
            className={step === 1 ? 'text-foreground font-medium' : 'text-muted-foreground'}
            aria-current={step === 1 ? 'step' : undefined}
          >
            {t('orgStep')}
          </li>
          <li
            className={step === 2 ? 'text-foreground font-medium' : 'text-muted-foreground'}
            aria-current={step === 2 ? 'step' : undefined}
          >
            {t('projectStep')}
          </li>
        </ol>

        {step === 1 ? (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>{t('orgTitle')}</h2>
              </CardTitle>
              <CardDescription>{t('orgHint')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submitOrg} className="space-y-4">
                {error && <FormMessage tone="error">{error}</FormMessage>}
                <FormField id="org-name" label={t('orgName')}>
                  <Input
                    id="org-name"
                    required
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                  />
                </FormField>
                <Button type="submit" disabled={!orgName.trim() || createOrg.isPending}>
                  {t('create')}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>{t('projectTitle')}</h2>
              </CardTitle>
              <CardDescription>{t('projectHint')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && <FormMessage tone="error">{error}</FormMessage>}
              <ProjectForm
                submitLabel={t('finish')}
                pending={createProject.isPending}
                onSubmit={async (values) => {
                  setError(null);
                  try {
                    await createProject.mutateAsync(values);
                    router.replace('/app');
                  } catch (err) {
                    setError(errorMessage(err));
                  }
                }}
              />
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
