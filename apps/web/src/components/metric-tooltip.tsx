'use client';
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Tooltip, TooltipContent, TooltipTrigger } from '@seo/ui/tooltip';

export type MetricKey = 'volume' | 'kd' | 'cpc' | 'intent' | 'traffic' | 'credits';

/** Label + info icon whose tooltip explains the metric (texts in messages → metrics). */
export function MetricLabel({ metric, label }: { metric: MetricKey; label: string }) {
  const t = useTranslations('metrics');
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <Tooltip>
        <TooltipTrigger
          type="button"
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none"
          aria-label={t(metric)}
        >
          <Info className="size-3.5" aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{t(metric)}</TooltipContent>
      </Tooltip>
    </span>
  );
}
