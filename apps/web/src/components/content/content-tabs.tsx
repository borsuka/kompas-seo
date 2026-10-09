'use client';
import { useTranslations } from 'next-intl';
import { cn } from '@seo/ui/cn';
import { Link, usePathname } from '@/i18n/navigation';

const TABS = [
  {
    href: '/app/content',
    key: 'briefs',
    match: (p: string) => p === '/app/content' || p.startsWith('/app/content/briefs'),
  },
  { href: '/app/content/gsc', key: 'gsc', match: (p: string) => p.startsWith('/app/content/gsc') },
] as const;

export function ContentTabs() {
  const t = useTranslations('content.tabs');
  const pathname = usePathname();
  return (
    <nav className="border-border mb-4 flex gap-1 overflow-x-auto border-b" aria-label={t('label')}>
      {TABS.map((tab) => {
        const active = tab.match(pathname);
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

const STATUS_STYLE = {
  queued: 'bg-muted text-muted-foreground',
  running: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  ready: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  failed: 'bg-red-500/15 text-red-700 dark:text-red-300',
} as const;

export function BriefStatus({ status }: { status: keyof typeof STATUS_STYLE }) {
  const t = useTranslations('content.status');
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', STATUS_STYLE[status])}>
      {t(status)}
    </span>
  );
}
