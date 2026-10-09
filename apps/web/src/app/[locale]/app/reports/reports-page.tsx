'use client';
import { FileDown, FileText } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { normalizeDomain } from '@seo/shared';
import { Alert } from '@seo/ui/alert';
import { Button } from '@seo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@seo/ui/card';
import { Input } from '@seo/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@seo/ui/select';
import { toast } from '@seo/ui/sonner';
import { useCurrentProject } from '@/components/app-shell/project-context';
import { FormField } from '@/components/auth/auth-card';
import { PageHeader } from '@/components/page-header';
import { domainReportUrl, downloadFile } from '@/lib/account-api';
import { useCan } from '@/lib/queries';
import { useErrorMessage } from '@/lib/use-error-message';

type Ui = 'bg' | 'en';

export function ReportsPage() {
  const t = useTranslations('reports');
  const locale = useLocale();
  const can = useCan();
  const params = useSearchParams();
  const errorMessage = useErrorMessage();
  const { current } = useCurrentProject();
  const [domain, setDomain] = useState(params.get('domain') ?? '');
  const [ui, setUi] = useState<Ui>(locale === 'en' ? 'en' : 'bg');
  const [busy, setBusy] = useState(false);

  const target = domain.trim() || current?.domain || '';
  const normalized = (target && normalizeDomain(target)) || '';
  // Rankings and Search Console belong to the project: only for the project's own domain.
  const isProject = !!current && normalized === current.domain;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!normalized) return;
    setBusy(true);
    try {
      await downloadFile(
        domainReportUrl({
          domain: normalized,
          loc: String(current?.locationCode ?? 2100),
          lang: current?.languageCode ?? 'bg',
          projectId: isProject ? current.id : undefined,
          ui,
        }),
        `seo-report-${normalized}.pdf`,
      );
      toast.success(t('ready'));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const sections = isProject
    ? (['organic', 'backlinks', 'rankings', 'gsc'] as const)
    : (['organic', 'backlinks'] as const);

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('domainReport')}</h2>
            </CardTitle>
            <CardDescription>{t('domainReportBody')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="max-w-lg space-y-4">
              <FormField id="report-domain" label={t('domain')} hint={t('domainHint')}>
                <Input
                  id="report-domain"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder={current?.domain ?? 'example.bg'}
                />
              </FormField>
              <FormField id="report-ui" label={t('language')}>
                <Select value={ui} onValueChange={(v) => setUi(v as Ui)}>
                  <SelectTrigger id="report-ui" className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bg">{t('languages.bg')}</SelectItem>
                    <SelectItem value="en">{t('languages.en')}</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              {!can('research:run') && <Alert variant="info">{t('viewerNote')}</Alert>}
              <Button type="submit" disabled={!normalized || busy}>
                <FileDown aria-hidden /> {busy ? t('generating') : t('download')}
              </Button>
              <p className="text-muted-foreground text-xs">{t('creditsNote')}</p>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="size-4" aria-hidden />
              <h2>{t('contents')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1.5 pl-5 text-sm">
              {sections.map((s) => (
                <li key={s}>{t(`sections.${s}`)}</li>
              ))}
            </ul>
            {!isProject && current && (
              <p className="text-muted-foreground mt-3 text-xs">
                {t('projectOnly', { domain: current.domain })}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
