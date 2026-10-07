'use client';
import { Coins } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { CreditLedgerEntry } from '@seo/shared';
import { Button } from '@seo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@seo/ui/card';
import { Skeleton } from '@seo/ui/skeleton';
import { ResponsiveTable, type Column } from '@/components/responsive-table';
import { EmptyState, ErrorState } from '@/components/states';
import { useCreditLedger, useCredits } from '@/lib/queries';

export function CreditsSettings() {
  const t = useTranslations('settings.credits');
  const tPlans = useTranslations('plans');
  const format = useFormatter();
  const credits = useCredits();
  const [page, setPage] = useState(1);
  const ledger = useCreditLedger(page);

  const columns: Column<CreditLedgerEntry>[] = [
    {
      key: 'date',
      header: t('date'),
      primary: true,
      cell: (e) =>
        format.dateTime(new Date(e.createdAt), { dateStyle: 'medium', timeStyle: 'short' }),
    },
    { key: 'reason', header: t('reason'), cell: (e) => t(`reasons.${e.reason}`) },
    {
      key: 'change',
      header: t('change'),
      align: 'right',
      cell: (e) => (
        <span
          className={e.delta < 0 ? 'text-destructive' : e.delta > 0 ? 'text-success' : undefined}
        >
          {format.number(e.delta, { signDisplay: 'exceptZero' })}
        </span>
      ),
    },
    {
      key: 'balance',
      header: t('balanceAfter'),
      align: 'right',
      cell: (e) => format.number(e.balanceAfter),
    },
  ];

  const totalPages = ledger.data
    ? Math.max(1, Math.ceil(ledger.data.total / ledger.data.pageSize))
    : 1;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>{t('balance')}</CardDescription>
            <CardTitle className="tabular text-3xl">
              {credits.data ? (
                format.number(credits.data.balance)
              ) : (
                <Skeleton className="h-9 w-24" />
              )}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t('monthly')}</CardDescription>
            <CardTitle className="tabular text-3xl">
              {credits.data ? (
                format.number(credits.data.monthlyCredits)
              ) : (
                <Skeleton className="h-9 w-24" />
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            {credits.data && tPlans(credits.data.plan)}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t('history')}</h2>
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {ledger.error ? (
            <ErrorState error={ledger.error} onRetry={() => ledger.refetch()} />
          ) : ledger.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : ledger.data.items.length === 0 ? (
            <EmptyState icon={Coins} title={t('history')} description={t('empty')} />
          ) : (
            <>
              <ResponsiveTable
                columns={columns}
                rows={ledger.data.items}
                rowKey={(e) => e.id}
                caption={t('history')}
              />
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    ‹
                  </Button>
                  <span className="tabular text-sm">
                    {page} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    ›
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
