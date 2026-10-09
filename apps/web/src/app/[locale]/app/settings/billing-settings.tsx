'use client';
import { Check, CreditCard, ExternalLink, Minus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import type { BillingOverview } from '@seo/shared';
import { Alert } from '@seo/ui/alert';
import { Badge } from '@seo/ui/badge';
import { Button } from '@seo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@seo/ui/card';
import { cn } from '@seo/ui/cn';
import { Skeleton } from '@seo/ui/skeleton';
import { toast } from '@seo/ui/sonner';
import { ErrorState } from '@/components/states';
import { useBilling, useCheckout, usePortal } from '@/lib/account-api';
import { useCan } from '@/lib/queries';
import { useErrorMessage } from '@/lib/use-error-message';

type PlanRow = BillingOverview['plans'][number];

export function BillingSettings() {
  const t = useTranslations();
  const format = useFormatter();
  const can = useCan();
  const params = useSearchParams();
  const errorMessage = useErrorMessage();
  const billing = useBilling();
  const checkout = useCheckout();
  const portal = usePortal();
  const canManage = can('billing:manage');
  const returned = params.get('checkout');

  const go = (p: Promise<{ url: string }>) =>
    p.then(({ url }) => window.location.assign(url)).catch((err) => toast.error(errorMessage(err)));

  if (billing.error) return <ErrorState error={billing.error} onRetry={() => billing.refetch()} />;
  if (billing.isPending) return <Skeleton className="h-64" />;
  const b = billing.data;
  const subscribed = b.plan !== 'free' && b.hasCustomer;

  const limit = (n: number) => format.number(n);
  const features = (p: PlanRow) => [
    { label: t('settings.billing.credits', { n: format.number(p.monthlyCredits) }), on: true },
    { label: t('settings.billing.projects', { n: limit(p.maxProjects) }), on: true },
    { label: t('settings.billing.members', { n: limit(p.maxMembers) }), on: true },
    { label: t('settings.billing.tracked', { n: limit(p.maxTrackedKeywords) }), on: true },
    { label: t('settings.billing.api'), on: p.apiAccess },
  ];

  return (
    <div className="space-y-6">
      {returned === 'success' && <Alert variant="info">{t('settings.billing.success')}</Alert>}
      {returned === 'cancelled' && <Alert>{t('settings.billing.cancelled')}</Alert>}
      {!b.enabled && <Alert variant="info">{t('settings.billing.disabled')}</Alert>}
      {!canManage && <Alert variant="info">{t('settings.billing.ownerOnly')}</Alert>}

      <Card>
        <CardHeader>
          <CardDescription>{t('settings.billing.current')}</CardDescription>
          <CardTitle className="flex flex-wrap items-center gap-2 text-2xl">
            {t(`plans.${b.plan}`)}
            <Badge variant={['active', 'trialing'].includes(b.status) ? 'success' : 'destructive'}>
              {t(`settings.billing.status.${statusKey(b.status)}`)}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground text-sm">
            {b.currentPeriodEnd
              ? t(b.cancelAtPeriodEnd ? 'settings.billing.endsOn' : 'settings.billing.renewsOn', {
                  date: format.dateTime(new Date(b.currentPeriodEnd), { dateStyle: 'long' }),
                })
              : t('settings.billing.freeNote')}
          </p>
          {b.enabled && b.hasCustomer && canManage && (
            <Button
              variant="outline"
              disabled={portal.isPending}
              onClick={() => go(portal.mutateAsync())}
            >
              <CreditCard aria-hidden /> {t('settings.billing.portal')}
              <ExternalLink aria-hidden className="size-3" />
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {b.plans.map((p) => {
          const current = p.id === b.plan;
          return (
            <Card key={p.id} className={cn(current && 'border-primary ring-primary/30 ring-2')}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <h3>{t(`plans.${p.id}`)}</h3>
                  {current && <Badge>{t('settings.billing.yourPlan')}</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-1.5 text-sm">
                  {features(p).map((f) => (
                    <li
                      key={f.label}
                      className={cn('flex items-start gap-2', !f.on && 'text-muted-foreground')}
                    >
                      {f.on ? (
                        <Check className="text-success mt-0.5 size-4 shrink-0" aria-hidden />
                      ) : (
                        <Minus className="mt-0.5 size-4 shrink-0" aria-hidden />
                      )}
                      <span>
                        {f.label}
                        {!f.on && (
                          <span className="sr-only"> ({t('settings.billing.notIncluded')})</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                {p.id !== 'free' && !current && canManage && (
                  <Button
                    className="w-full"
                    disabled={!p.purchasable || checkout.isPending}
                    onClick={() =>
                      // Existing subscribers change plans in the Stripe portal.
                      subscribed
                        ? go(portal.mutateAsync())
                        : go(checkout.mutateAsync(p.id as 'pro' | 'agency'))
                    }
                  >
                    {subscribed ? t('settings.billing.change') : t('settings.billing.upgrade')}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="text-muted-foreground text-xs">{t('settings.billing.stripeNote')}</p>
    </div>
  );
}

const STATUSES = ['active', 'trialing', 'past_due', 'canceled', 'incomplete'] as const;
const statusKey = (s: string) =>
  (STATUSES as readonly string[]).includes(s) ? (s as (typeof STATUSES)[number]) : 'active';
