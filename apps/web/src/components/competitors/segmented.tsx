'use client';
import { cn } from '@seo/ui/cn';

/** Pill-style single choice (tabs inside a page: change filters, gap categories, ...). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; count?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={label}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors',
              active
                ? 'border-primary bg-primary/10 text-primary font-medium'
                : 'border-border hover:bg-muted',
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span className="tabular text-muted-foreground ml-1">{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
