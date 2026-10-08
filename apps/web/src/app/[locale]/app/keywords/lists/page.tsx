'use client';
import { ListChecks, Plus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Badge } from '@seo/ui/badge';
import { Button } from '@seo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@seo/ui/card';
import { Input } from '@seo/ui/input';
import { Skeleton } from '@seo/ui/skeleton';
import { toast } from '@seo/ui/sonner';
import { useCurrentProject } from '@/components/app-shell/project-context';
import { KeywordsTabs } from '@/components/keywords/keywords-tabs';
import { LocalePicker } from '@/components/keywords/locale-picker';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState } from '@/components/states';
import { Link, useRouter } from '@/i18n/navigation';
import { useCreateList, useKeywordLists } from '@/lib/keywords-api';
import { useCan } from '@/lib/queries';
import { useErrorMessage } from '@/lib/use-error-message';

export default function KeywordListsPage() {
  const t = useTranslations('keywords');
  const tc = useTranslations();
  const format = useFormatter();
  const can = useCan();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const { current } = useCurrentProject();
  const lists = useKeywordLists();
  const create = useCreateList();
  const [name, setName] = useState('');
  const [loc, setLoc] = useState(current?.locationCode ?? 2100);
  const [lang, setLang] = useState(current?.languageCode ?? 'bg');

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const list = await create.mutateAsync({
        name: name.trim(),
        locationCode: loc as 2100,
        languageCode: lang as 'bg',
        projectId: current?.id,
      });
      setName('');
      router.push(`/app/keywords/lists/${list.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeader title={t('lists.title')} />
      <KeywordsTabs />
      {can('keywordList:create') && (
        <form onSubmit={submit} className="mb-6 flex flex-col gap-2 lg:flex-row">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('lists.name')}
            aria-label={t('lists.name')}
            className="h-10 lg:max-w-sm"
          />
          <LocalePicker
            loc={loc}
            lang={lang}
            onChange={(l, lg) => {
              setLoc(l);
              setLang(lg);
            }}
          />
          <Button type="submit" className="h-10" disabled={!name.trim() || create.isPending}>
            <Plus aria-hidden /> {t('lists.new')}
          </Button>
        </form>
      )}

      {lists.error ? (
        <ErrorState error={lists.error} onRetry={() => lists.refetch()} />
      ) : lists.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : lists.data.length === 0 ? (
        <EmptyState icon={ListChecks} title={t('lists.empty')} description={t('lists.emptyBody')} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lists.data.map((l) => (
            <li key={l.id}>
              <Link
                href={`/app/keywords/lists/${l.id}`}
                className="focus-visible:ring-ring block rounded-lg focus-visible:ring-2 focus-visible:outline-none"
              >
                <Card className="hover:border-primary/50 h-full transition-colors">
                  <CardHeader>
                    <CardTitle className="truncate">
                      <h2>{l.name}</h2>
                    </CardTitle>
                    <CardDescription>{t('lists.items', { count: l.itemCount })}</CardDescription>
                  </CardHeader>
                  <CardContent className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="outline">
                      {tc(`languages.${l.languageCode}` as 'languages.bg')}
                    </Badge>
                    {l.tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                    <span>
                      {l.clusteredAt
                        ? t('lists.clusteredAt', {
                            date: format.dateTime(new Date(l.clusteredAt), { dateStyle: 'medium' }),
                          })
                        : t('lists.notClustered')}
                    </span>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
