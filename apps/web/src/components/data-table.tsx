'use client';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@seo/ui/button';
import { cn } from '@seo/ui/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@seo/ui/dropdown-menu';
import { Skeleton } from '@seo/ui/skeleton';
import { MetricInfo, type MetricKey } from '@/components/metric-tooltip';

export interface DataColumn<T> {
  id: string;
  header: ReactNode;
  /** Plain-text header for menus and mobile cards. */
  label: string;
  cell: (row: T) => ReactNode;
  /** Adds an info tooltip explaining the metric next to the header. */
  metric?: MetricKey;
  /** Server sort field; makes the header clickable. */
  sortKey?: string;
  align?: 'left' | 'right';
  /** Can be toggled in the column chooser (the primary column cannot). */
  hideable?: boolean;
  defaultHidden?: boolean;
  /** Shown as the card title on mobile. */
  primary?: boolean;
  className?: string;
}

interface Props<T> {
  columns: DataColumn<T>[];
  rows: T[];
  rowId: (row: T) => string;
  caption: string;
  loading?: boolean;
  /** Persists the column chooser per table (localStorage). */
  storageKey: string;
  sort?: { field: string; dir: 'asc' | 'desc' };
  onSort?: (field: string) => void;
  selection?: {
    selected: Set<string>;
    onChange: (next: Set<string>) => void;
    rowLabel: (row: T) => string;
  };
  empty?: ReactNode;
  toolbar?: ReactNode;
}

const VIRTUALIZE_FROM = 100;
const ROW_HEIGHT = 41;

function useColumnVisibility<T>(storageKey: string, columns: DataColumn<T>[]) {
  const defaults = () => Object.fromEntries(columns.map((c) => [c.id, !c.defaultHidden]));
  const [visible, setVisible] = useState<Record<string, boolean>>(defaults);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`kompas:cols:${storageKey}`);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate persisted preference after mount
      if (saved) setVisible((v) => ({ ...v, ...(JSON.parse(saved) as Record<string, boolean>) }));
    } catch {
      // storage unavailable: keep defaults
    }
  }, [storageKey]);
  const toggle = (id: string) =>
    setVisible((v) => {
      const next = { ...v, [id]: !v[id] };
      try {
        localStorage.setItem(`kompas:cols:${storageKey}`, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  return { visible, toggle };
}

/**
 * Server-driven table: sorting/filtering/paging happen in the API; this component
 * renders, lets users pick columns and select rows, virtualizes long pages and
 * switches to cards on small screens.
 */
export function DataTable<T>({
  columns,
  rows,
  rowId,
  caption,
  loading,
  storageKey,
  sort,
  onSort,
  selection,
  empty,
  toolbar,
}: Props<T>) {
  const t = useTranslations('keywords');
  const { visible, toggle } = useColumnVisibility(storageKey, columns);
  const shown = columns.filter((c) => !c.hideable || visible[c.id] !== false);
  const primary = columns.find((c) => c.primary) ?? columns[0]!;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualize = rows.length > VIRTUALIZE_FROM;
  // eslint-disable-next-line react-hooks/incompatible-library -- the app does not use the React Compiler
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    enabled: virtualize,
  });

  const ids = rows.map(rowId);
  const allSelected =
    !!selection && ids.length > 0 && ids.every((id) => selection.selected.has(id));
  const toggleAll = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (allSelected) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    selection.onChange(next);
  };
  const toggleRow = (id: string) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selection.onChange(next);
  };

  const items = virtualize
    ? virtualizer.getVirtualItems()
    : rows.map((_, index) => ({ index, start: 0, size: ROW_HEIGHT }));
  const padTop = virtualize && items.length ? items[0]!.start : 0;
  const padBottom =
    virtualize && items.length
      ? virtualizer.getTotalSize() - items[items.length - 1]!.start - items[items.length - 1]!.size
      : 0;

  const sortIcon = (key?: string) => {
    if (!key || !onSort) return null;
    if (sort?.field !== key) return <ArrowUpDown className="size-3 opacity-40" aria-hidden />;
    return sort.dir === 'asc' ? (
      <ArrowUp className="size-3" aria-hidden />
    ) : (
      <ArrowDown className="size-3" aria-hidden />
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">{toolbar}</div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Columns3 aria-hidden /> {t('columnsMenu')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t('columnsMenu')}</DropdownMenuLabel>
            {columns
              .filter((c) => c.hideable)
              .map((c) => (
                <label
                  key={c.id}
                  className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-primary)]"
                    checked={visible[c.id] !== false}
                    onChange={() => toggle(c.id)}
                  />
                  {c.label}
                </label>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Desktop table */}
      <div
        ref={scrollRef}
        className={cn(
          'border-border hidden rounded-lg border md:block',
          virtualize ? 'max-h-[70vh] overflow-auto' : 'overflow-x-auto',
        )}
      >
        <table className="w-full caption-bottom text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-background sticky top-0 z-10 shadow-[inset_0_-1px_0_var(--color-border)]">
            <tr>
              {selection && (
                <th className="w-10 px-3">
                  <input
                    type="checkbox"
                    aria-label={t('selectAll')}
                    className="size-4 accent-[var(--color-primary)]"
                    checked={allSelected}
                    onChange={toggleAll}
                  />
                </th>
              )}
              {shown.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  aria-sort={
                    sort?.field === c.sortKey
                      ? sort?.dir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                  className={cn(
                    'text-muted-foreground h-10 px-3 text-xs font-medium whitespace-nowrap',
                    c.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex items-center gap-1',
                      c.align === 'right' && 'flex-row-reverse',
                    )}
                  >
                    {c.metric && <MetricInfo metric={c.metric} />}
                    {c.sortKey && onSort ? (
                      <button
                        type="button"
                        onClick={() => onSort(c.sortKey!)}
                        aria-label={t('sortBy', { column: c.label })}
                        className={cn(
                          'hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm focus-visible:ring-2 focus-visible:outline-none',
                          c.align === 'right' && 'flex-row-reverse',
                        )}
                      >
                        {c.header}
                        {sortIcon(c.sortKey)}
                      </button>
                    ) : (
                      c.header
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !rows.length
              ? Array.from({ length: 8 }, (_, i) => (
                  <tr key={i} className="border-border border-b">
                    <td colSpan={shown.length + (selection ? 1 : 0)} className="px-3 py-2.5">
                      <Skeleton className="h-5" />
                    </td>
                  </tr>
                ))
              : null}
            {padTop > 0 && (
              <tr aria-hidden style={{ height: padTop }}>
                <td colSpan={shown.length + (selection ? 1 : 0)} />
              </tr>
            )}
            {items.map(({ index }) => {
              const row = rows[index]!;
              const id = rowId(row);
              const isSel = selection?.selected.has(id) ?? false;
              return (
                <tr
                  key={id}
                  data-state={isSel ? 'selected' : undefined}
                  className={cn(
                    'border-border hover:bg-muted/50 data-[state=selected]:bg-primary/5 h-[41px] border-b',
                    loading && 'opacity-60',
                  )}
                >
                  {selection && (
                    <td className="px-3">
                      <input
                        type="checkbox"
                        aria-label={selection.rowLabel(row)}
                        className="size-4 accent-[var(--color-primary)]"
                        checked={isSel}
                        onChange={() => toggleRow(id)}
                      />
                    </td>
                  )}
                  {shown.map((c) => (
                    <td
                      key={c.id}
                      className={cn(
                        'px-3 py-2 align-middle',
                        c.align === 'right' && 'tabular text-right',
                        c.className,
                      )}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {padBottom > 0 && (
              <tr aria-hidden style={{ height: padBottom }}>
                <td colSpan={shown.length + (selection ? 1 : 0)} />
              </tr>
            )}
          </tbody>
        </table>
        {!loading && !rows.length && empty}
      </div>

      {/* Mobile cards */}
      <ul className="space-y-2 md:hidden" aria-label={caption}>
        {loading &&
          !rows.length &&
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}
        {rows.map((row) => {
          const id = rowId(row);
          return (
            <li key={id} className="border-border bg-card rounded-lg border p-3">
              <div className="mb-2 flex items-start gap-2">
                {selection && (
                  <input
                    type="checkbox"
                    aria-label={selection.rowLabel(row)}
                    className="mt-0.5 size-4 accent-[var(--color-primary)]"
                    checked={selection.selected.has(id)}
                    onChange={() => toggleRow(id)}
                  />
                )}
                <div className="min-w-0 flex-1 font-medium">{primary.cell(row)}</div>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                {shown
                  .filter((c) => c !== primary)
                  .map((c) => (
                    <div key={c.id} className="contents">
                      <dt className="text-muted-foreground">{c.label}</dt>
                      <dd className="tabular text-right">{c.cell(row)}</dd>
                    </div>
                  ))}
              </dl>
            </li>
          );
        })}
        {!loading && !rows.length && empty}
      </ul>
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
}) {
  const t = useTranslations('keywords.pagination');
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav
      className="flex flex-wrap items-center justify-end gap-3 text-sm"
      aria-label={t('page', { page, pages })}
    >
      {onPageSize && (
        <label className="text-muted-foreground flex items-center gap-2">
          {t('pageSize')}
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="border-input bg-background text-foreground h-8 rounded-md border px-2"
          >
            {[25, 50, 100, 250, 500].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
      <span className="tabular text-muted-foreground">{t('page', { page, pages })}</span>
      <Button
        variant="outline"
        size="icon"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        aria-label={t('prev')}
      >
        <ChevronLeft aria-hidden />
      </Button>
      <Button
        variant="outline"
        size="icon"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
        aria-label={t('next')}
      >
        <ChevronRight aria-hidden />
      </Button>
    </nav>
  );
}
