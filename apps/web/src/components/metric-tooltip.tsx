'use client';
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Tooltip, TooltipContent, TooltipTrigger } from '@seo/ui/tooltip';

export type MetricKey =
  | 'volume'
  | 'kd'
  | 'cpc'
  | 'intent'
  | 'traffic'
  | 'credits'
  | 'competition'
  | 'trafficPotential'
  | 'parentTopic'
  | 'organicKeywords'
  | 'domainRating'
  | 'competitionLevel'
  | 'visibility'
  | 'avgPosition'
  | 'shareOfVoice'
  | 'volatility'
  | 'spamScore'
  | 'toxicity';

/** Info icon whose tooltip explains the metric (texts in messages → metrics). */
export function MetricInfo({ metric }: { metric: MetricKey }) {
  const t = useTranslations('metrics');
  return (
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
  );
}

/** Label + info icon. In tables use the column's `metric` instead (keeps buttons un-nested). */
export function MetricLabel({ metric, label }: { metric: MetricKey; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <MetricInfo metric={metric} />
    </span>
  );
}
