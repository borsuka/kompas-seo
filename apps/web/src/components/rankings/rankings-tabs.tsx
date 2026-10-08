'use client';
import { useTranslations } from 'next-intl';
import { cn } from '@seo/ui/cn';
import { Link, usePathname } from '@/i18n/navigation';

const TABS = [
  { href: '/app/rankings', key: 'overview' },
  { href: '/app/rankings/keywords', key: 'keywords' },
  { href: '/app/rankings/alerts', key: 'alerts' },
] as const;

export function RankingsTabs() {
  const t = useTranslations('rankings.tabs');
  const pathname = usePathname();
  return (
    <nav className="border-border mb-4 flex gap-1 overflow-x-auto border-b" aria-label={t('label')}>
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
              active
                ? 'border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground border-transparent',
            )}
          >
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
