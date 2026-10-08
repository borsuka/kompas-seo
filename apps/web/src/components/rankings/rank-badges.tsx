'use client';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@seo/ui/cn';

/** Position (null = not in the top 100). */
export function Position({ value }: { value: number | null }) {
  const t = useTranslations('rankings');
  if (value === null)
    return (
      <span className="text-muted-foreground text-xs" title={t('notRanked')}>
        {t('notRankedShort')}
      </span>
    );
  return (
    <span
      className={cn(
        'tabular inline-block min-w-7 rounded px-1.5 py-0.5 text-center text-sm font-semibold',
        value <= 3
          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
          : value <= 10
            ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
            : 'bg-muted',
      )}
    >
      {value}
    </span>
  );
}

/** Position change; positive = moved up. */
export function Change({ value }: { value: number | null }) {
  const t = useTranslations('rankings');
  if (value === null || value === 0) return <span className="text-muted-foreground">–</span>;
  const up = value > 0;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        'tabular inline-flex items-center gap-0.5 text-xs font-medium',
        up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
      )}
    >
      <Icon className="size-3" aria-hidden />
      {Math.abs(value)}
      <span className="sr-only">{up ? t('movedUp') : t('movedDown')}</span>
    </span>
  );
}

/** Position history sparkline: up is better (position 1 at the top), gaps = not ranked. */
export function PositionSparkline({
  values,
  label,
}: {
  values: readonly (number | null)[];
  label: string;
}) {
  if (values.length < 2) return <span className="text-muted-foreground">–</span>;
  const w = 72;
  const h = 20;
  const ranked = values.filter((v): v is number => v !== null);
  const min = Math.min(...ranked, 1);
  const max = Math.max(...ranked, min + 1);
  const step = w / (values.length - 1);
  const y = (v: number) => 1 + ((v - min) / (max - min)) * (h - 2);
  // Split into segments at unranked checks.
  const segments: string[] = [];
  let current: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length) segments.push(current.join(' '));
      current = [];
    } else current.push(`${(i * step).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (current.length) segments.push(current.join(' '));
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={label}
      className="text-primary"
    >
      {segments.map((points, i) =>
        points.includes(' ') ? (
          <polyline
            key={i}
            points={points}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        ) : (
          <circle
            key={i}
            cx={points.split(',')[0]}
            cy={points.split(',')[1]}
            r="1.5"
            fill="currentColor"
          />
        ),
      )}
    </svg>
  );
}
