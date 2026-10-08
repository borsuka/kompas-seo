'use client';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { cn } from '@seo/ui/cn';
import { Link, usePathname } from '@/i18n/navigation';

/** Query params that carry over between the research tabs. */
const SHARED = ['domain'] as const;

const TABS = [
  { href: '/app/backlinks', key: 'overview' },
  { href: '/app/backlinks/links', key: 'links' },
  { href: '/app/backlinks/domains', key: 'domains' },
  { href: '/app/backlinks/anchors', key: 'anchors' },
  { href: '/app/backlinks/link-gap', key: 'linkGap' },
  { href: '/app/backlinks/toxic', key: 'toxic' },
] as const;

export function BacklinksTabs() {
  const t = useTranslations('backlinks.tabs');
  const pathname = usePathname();
  const search = useSearchParams();
  const carry = new URLSearchParams();
  for (const k of SHARED) {
    const v = search.get(k);
    if (v) carry.set(k, v);
  }
  const suffix = carry.size ? `?${carry.toString()}` : '';
  return (
    <nav className="border-border mb-4 flex gap-1 overflow-x-auto border-b" aria-label={t('label')}>
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={`${tab.href}${suffix}`}
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
