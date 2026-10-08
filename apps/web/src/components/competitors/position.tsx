'use client';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@seo/ui/cn';

/** Position change: previous − current (positive = moved up), null = new keyword. */
export function PositionChange({ change }: { change: number | null }) {
  const t = useTranslations('competitors');
  if (change === null)
    return (
      <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-300">
        {t('new')}
      </span>
    );
  if (change === 0) return <span className="text-muted-foreground">–</span>;
  const up = change > 0;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        'tabular inline-flex items-center gap-0.5 text-xs font-medium',
        up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
      )}
    >
      <Icon className="size-3" aria-hidden />
      {Math.abs(change)}
      <span className="sr-only">{up ? t('movedUp') : t('movedDown')}</span>
    </span>
  );
}

/** Position of a domain in a keyword gap cell, coloured against the best competitor. */
export function GapPosition({ position, best }: { position: number | null; best: boolean }) {
  if (position === null) return <span className="text-muted-foreground">–</span>;
  return (
    <span
      className={cn(
        'tabular inline-block min-w-7 rounded px-1.5 py-0.5 text-center text-xs font-medium',
        best ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-muted',
      )}
    >
      {position}
    </span>
  );
}

export function UrlCell({ url }: { url: string }) {
  let path = url;
  try {
    const u = new URL(url);
    path = u.pathname + u.search || '/';
  } catch {
    // keep the raw value
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="text-muted-foreground block max-w-xs truncate text-xs hover:underline"
      title={url}
    >
      {path}
    </a>
  );
}
