'use client';
import { useFormatter, useTranslations } from 'next-intl';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@seo/ui/dialog';
import { Skeleton } from '@seo/ui/skeleton';
import { ErrorState } from '@/components/states';
import { useKeywordHistory } from '@/lib/rankings-api';

const COLORS = ['#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#64748b'];
/** Unranked checks are drawn just below the chart floor. */
const FLOOR = 101;

export function HistoryDialog({
  projectId,
  projectDomain,
  keywordId,
  keyword,
  onClose,
}: {
  projectId: string;
  projectDomain: string;
  keywordId: string | null;
  keyword: string;
  onClose: () => void;
}) {
  const t = useTranslations('rankings.history');
  const format = useFormatter();
  const history = useKeywordHistory(projectId, keywordId);
  const h = history.data;

  const byDate = new Map<string, Record<string, number | string | null>>();
  for (const p of h?.points ?? [])
    byDate.set(p.date, { date: p.date, [projectDomain]: p.position ?? FLOOR, url: p.url });
  for (const c of h?.competitors ?? [])
    for (const p of c.points)
      byDate.set(p.date, {
        ...(byDate.get(p.date) ?? { date: p.date }),
        [c.domain]: p.position ?? FLOOR,
      });
  const data = [...byDate.values()]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((d) => ({
      ...d,
      label: format.dateTime(new Date(`${d.date as string}T00:00:00Z`), {
        day: 'numeric',
        month: 'short',
      }),
    }));
  const lines = [projectDomain, ...(h?.competitors ?? []).map((c) => c.domain)];
  // Zoom the axis to the data unless something dropped out of the top 100.
  const values = data
    .flatMap((d) => lines.map((l) => (d as Record<string, unknown>)[l]))
    .filter((v): v is number => typeof v === 'number');
  const yMax = values.some((v) => v >= FLOOR)
    ? FLOOR
    : Math.min(FLOOR, Math.ceil((Math.max(1, ...values) + 2) / 5) * 5);

  return (
    <Dialog open={!!keywordId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('close')} className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{keyword}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {history.error ? (
          <ErrorState error={history.error} onRetry={() => history.refetch()} />
        ) : !h ? (
          <Skeleton className="h-72" />
        ) : data.length === 0 ? (
          <p className="text-muted-foreground py-12 text-center text-sm">{t('empty')}</p>
        ) : (
          <div className="h-72" role="img" aria-label={t('description')}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--color-border)" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  stroke="var(--color-muted-foreground)"
                />
                <YAxis
                  reversed
                  domain={[1, yMax]}
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  width={32}
                  stroke="var(--color-muted-foreground)"
                  tickFormatter={(v: number) => (v >= FLOOR ? '' : String(v))}
                />
                <ChartTooltip
                  contentStyle={{
                    background: 'var(--color-popover)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 6,
                    color: 'var(--color-popover-foreground)',
                  }}
                  formatter={(v, name) => [
                    Number(v) >= FLOOR ? t('notRanked') : String(v),
                    String(name),
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {lines.map((d, i) => (
                  <Line
                    key={d}
                    type="monotone"
                    dataKey={d}
                    stroke={i === 0 ? 'var(--color-primary)' : COLORS[(i - 1) % COLORS.length]}
                    strokeWidth={i === 0 ? 2.5 : 1.5}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
