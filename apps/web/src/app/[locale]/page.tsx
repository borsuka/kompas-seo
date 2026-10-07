import { BarChart3, Link2, Search, Target } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { Button } from '@seo/ui/button';
import { Link } from '@/i18n/navigation';
import { PublicHeader } from '@/components/public-header';

export default function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations('landing');

  const features = [
    { icon: Search, text: t('features.keywords') },
    { icon: Target, text: t('features.competitors') },
    { icon: Link2, text: t('features.gaps') },
    { icon: BarChart3, text: t('features.tracking') },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-10 px-4 py-16 sm:px-6">
        <div className="max-w-2xl space-y-5">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
            {t('title')}
          </h1>
          <p className="text-muted-foreground text-lg text-pretty">{t('subtitle')}</p>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" asChild>
              <Link href="/sign-up">{t('ctaPrimary')}</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/sign-in">{t('ctaSecondary')}</Link>
            </Button>
          </div>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {features.map(({ icon: Icon, text }) => (
            <li
              key={text}
              className="border-border bg-card flex items-start gap-3 rounded-lg border p-4"
            >
              <Icon className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
              <span className="text-sm">{text}</span>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
