'use client';
import { Coins } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Tooltip, TooltipContent, TooltipTrigger } from '@seo/ui/tooltip';
import { Link } from '@/i18n/navigation';

export function CreditsBadge({ balance }: { balance: number }) {
  const t = useTranslations('shell');
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href="/app/settings?tab=credits"
          className="border-border tabular hover:bg-muted hidden items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium sm:inline-flex"
        >
          <Coins className="text-muted-foreground size-3.5" aria-hidden />
          {t('credits', { count: balance })}
        </Link>
      </TooltipTrigger>
      <TooltipContent>{t('creditsTooltip')}</TooltipContent>
    </Tooltip>
  );
}
