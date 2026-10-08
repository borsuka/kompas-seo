'use client';
import { useTranslations } from 'next-intl';
import type { LinkRel, ToxicityDto } from '@seo/shared';
import { Tooltip, TooltipContent, TooltipTrigger } from '@seo/ui/tooltip';
import { cn } from '@seo/ui/cn';

const LEVEL_STYLE = {
  low: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  medium: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  high: 'bg-red-500/15 text-red-700 dark:text-red-300',
} as const;

/** Toxicity score with its level colour; the tooltip lists the reasons. */
export function ToxicityBadge({ value }: { value: ToxicityDto }) {
  const t = useTranslations('backlinks.toxicity');
  const badge = (
    <span
      className={cn(
        'tabular inline-flex min-w-9 items-center justify-center rounded px-1.5 py-0.5 text-xs font-semibold',
        LEVEL_STYLE[value.level],
      )}
    >
      {value.score}
      <span className="sr-only"> {t(`levels.${value.level}`)}</span>
    </span>
  );
  if (!value.reasons.length) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="rounded focus-visible:ring-2 focus-visible:outline-none">
          {badge}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <ul className="space-y-0.5">
          {value.reasons.map((r) => (
            <li key={r}>{t(`reasons.${r}`)}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

export function RelBadge({ rel }: { rel: LinkRel }) {
  const t = useTranslations('backlinks.rel');
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-[11px] font-medium',
        rel === 'follow'
          ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
          : 'bg-muted text-muted-foreground',
      )}
    >
      {t(rel)}
    </span>
  );
}

export function Rating({ value }: { value: number }) {
  return (
    <span className="tabular inline-flex items-center gap-1.5">
      <span className="bg-muted h-1.5 w-10 overflow-hidden rounded-full" aria-hidden>
        <span
          className="bg-primary block h-full rounded-full"
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </span>
      {Math.round(value)}
    </span>
  );
}
