'use client';
import { FolderPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@seo/ui/button';
import { useCurrentProject } from '@/components/app-shell/project-context';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/states';
import { Link } from '@/i18n/navigation';
import { RankingsTabs } from './rankings-tabs';

/** Rank tracking always works on the active project. */
export function NoProject() {
  const t = useTranslations('rankings');
  return (
    <>
      <PageHeader title={t('title')} />
      <RankingsTabs />
      <EmptyState
        icon={FolderPlus}
        title={t('noProject')}
        action={
          <Button asChild>
            <Link href="/onboarding">{t('createProject')}</Link>
          </Button>
        }
      />
    </>
  );
}

export function useRankProject() {
  return useCurrentProject().current;
}
