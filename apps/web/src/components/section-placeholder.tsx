'use client';
import { Construction } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Badge } from '@seo/ui/badge';
import { Button } from '@seo/ui/button';
import { Link } from '@/i18n/navigation';
import { EmptyState } from './states';
import { PageHeader } from './page-header';

export type SectionKey =
  'keywords' | 'rankings' | 'competitors' | 'backlinks' | 'content' | 'reports';

/** Sections whose features ship in later phases: explain what's coming and what to do now. */
export function SectionPlaceholder({ section }: { section: SectionKey }) {
  const t = useTranslations('sections');
  const params = useSearchParams();
  const query = params.get('q') ?? params.get('domain');
  return (
    <>
      <PageHeader title={t(`${section}.title`)} description={t(`${section}.body`)} />
      <EmptyState
        icon={Construction}
        title={t(`${section}.title`)}
        description={t(`${section}.body`)}
      >
        <Badge variant="outline">{t(`${section}.phase`)}</Badge>
        {query && <p className="text-muted-foreground text-sm">{t('searchFor', { query })}</p>}
        <Button variant="outline" size="sm" asChild className="mt-2">
          <Link href="/app/settings?tab=project">{t('setUpProject')}</Link>
        </Button>
      </EmptyState>
    </>
  );
}
