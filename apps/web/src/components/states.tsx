'use client';
import { AlertTriangle, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button } from '@seo/ui/button';
import { Skeleton } from '@seo/ui/skeleton';
import { useErrorMessage } from '@/lib/use-error-message';

/** Empty state: always explains what to do next. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="border-border flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
      <span className="bg-muted flex size-10 items-center justify-center rounded-full">
        <Icon className="text-muted-foreground size-5" aria-hidden />
      </span>
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="text-muted-foreground max-w-md text-sm">{description}</p>}
      {children}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Error state with a retry action. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTranslations();
  const message = useErrorMessage();
  return (
    <div
      role="alert"
      className="border-destructive/30 bg-destructive/5 flex flex-col items-center gap-3 rounded-lg border px-6 py-10 text-center"
    >
      <AlertTriangle className="text-destructive size-6" aria-hidden />
      <h2 className="font-semibold">{t('errors.errorTitle')}</h2>
      <p className="text-muted-foreground text-sm">{message(error)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

/** Generic page skeleton while data loads. */
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  const t = useTranslations('common');
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only">{t('loading')}</span>
      <Skeleton className="h-8 w-56" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10" />
      ))}
    </div>
  );
}
