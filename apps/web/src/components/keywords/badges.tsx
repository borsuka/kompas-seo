'use client';
import { useTranslations } from 'next-intl';
import type { Intent, SerpFeature } from '@seo/shared';
import { cn } from '@seo/ui/cn';
import { Tooltip, TooltipContent, TooltipTrigger } from '@seo/ui/tooltip';

const INTENT_STYLE: Record<Intent, string> = {
  informational: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  navigational: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  commercial: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  transactional: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
};

export function IntentBadges({ intents }: { intents: readonly Intent[] }) {
  const t = useTranslations('keywords');
  return (
    <span className="inline-flex gap-1">
      {intents.map((i) => (
        <Tooltip key={i}>
          <TooltipTrigger asChild>
            <span
              className={cn(
                'inline-flex size-5 items-center justify-center rounded text-[11px] font-semibold',
                INTENT_STYLE[i],
              )}
            >
              <span aria-hidden>{t(`intentShort.${i}`)}</span>
              <span className="sr-only">{t(`intents.${i}`)}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>{t(`intents.${i}`)}</TooltipContent>
        </Tooltip>
      ))}
    </span>
  );
}

/** KD 0–100 with a coloured level (easy → very hard). */
export function KdBadge({ kd }: { kd: number | null }) {
  const t = useTranslations('keywords.kdLevels');
  if (kd === null) return <span className="text-muted-foreground">–</span>;
  const level = kd < 30 ? 'easy' : kd < 50 ? 'medium' : kd < 70 ? 'hard' : 'veryHard';
  const color = {
    easy: 'bg-emerald-500',
    medium: 'bg-amber-400',
    hard: 'bg-orange-500',
    veryHard: 'bg-red-500',
  }[level];
  return (
    <span className="tabular inline-flex items-center gap-1.5" title={t(level)}>
      <span className={cn('size-2 rounded-full', color)} aria-hidden />
      {kd}
      <span className="sr-only">{t(level)}</span>
    </span>
  );
}

export function FeatureList({
  features,
  max = 3,
}: {
  features: readonly SerpFeature[];
  max?: number;
}) {
  const t = useTranslations('keywords.features');
  if (!features.length) return <span className="text-muted-foreground">–</span>;
  const shown = features.slice(0, max);
  const rest = features.length - shown.length;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {shown.map((f) => (
        <span
          key={f}
          className="border-border rounded border px-1.5 py-0.5 text-[11px] whitespace-nowrap"
        >
          {t(f)}
        </span>
      ))}
      {rest > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="border-border rounded border px-1.5 py-0.5 text-[11px]">+{rest}</span>
          </TooltipTrigger>
          <TooltipContent>
            {features
              .slice(max)
              .map((f) => t(f))
              .join(', ')}
          </TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

/** Tiny inline trend chart (pure SVG, no chart library needed). */
export function Sparkline({ values, label }: { values: readonly number[]; label: string }) {
  if (values.length < 2) return <span className="text-muted-foreground">–</span>;
  const w = 64;
  const h = 18;
  const max = Math.max(...values, 1);
  const step = w / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`)
    .join(' ');
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={label}
      className="text-primary"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
