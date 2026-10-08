'use client';
import { useTranslations } from 'next-intl';
import { cn } from '@seo/ui/cn';
import { Link, usePathname } from '@/i18n/navigation';

/** Sub-navigation of the Keywords section. */
export function KeywordsTabs() {
  const t = useTranslations('keywords.tabs');
  const pathname = usePathname();
  const tabs = [
    {
      href: '/app/keywords',
      label: t('explorer'),
      active: !pathname.startsWith('/app/keywords/lists'),
    },
    {
      href: '/app/keywords/lists',
      label: t('lists'),
      active: pathname.startsWith('/app/keywords/lists'),
    },
  ];
  return (
    <nav className="border-border mb-4 flex gap-1 border-b" aria-label={t('explorer')}>
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? 'page' : undefined}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            tab.active
              ? 'border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground border-transparent',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
