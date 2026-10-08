'use client';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { INTENTS, SERP_FEATURES } from '@seo/shared';
import { Badge } from '@seo/ui/badge';
import { Button } from '@seo/ui/button';
import { Input } from '@seo/ui/input';

/** URL param names of every filter (same names as the API query). */
export const FILTER_KEYS = [
  'minVolume',
  'maxVolume',
  'minKd',
  'maxKd',
  'minCpc',
  'maxCpc',
  'minWords',
  'maxWords',
  'intents',
  'include',
  'exclude',
  'features',
] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type Values = Partial<Record<FilterKey, string>>;

const csvSet = (v?: string) => new Set((v ?? '').split(',').filter(Boolean));

export function countActiveFilters(params: Record<string, string>) {
  return FILTER_KEYS.filter((k) => params[k]).length;
}

/** Collapsible filter panel; applying writes the values to the URL (server-side filtering). */
export function FilterBar({
  params,
  onApply,
}: {
  params: Record<string, string>;
  onApply: (values: Record<FilterKey, string | null>) => void;
}) {
  const t = useTranslations('keywords');
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Values>(() =>
    Object.fromEntries(FILTER_KEYS.map((k) => [k, params[k] ?? ''])),
  );
  const active = countActiveFilters(params);

  const set = (k: FilterKey, v: string) => setValues((s) => ({ ...s, [k]: v }));
  const toggleCsv = (k: 'intents' | 'features', item: string) => {
    const s = csvSet(values[k]);
    if (s.has(item)) s.delete(item);
    else s.add(item);
    set(k, [...s].join(','));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onApply(
      Object.fromEntries(FILTER_KEYS.map((k) => [k, values[k]?.trim() || null])) as Record<
        FilterKey,
        string | null
      >,
    );
  };
  const reset = () => {
    setValues({});
    onApply(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])) as Record<FilterKey, null>);
  };

  const range = (label: string, min: FilterKey, max: FilterKey, step = '1') => (
    <fieldset className="space-y-1.5">
      <legend className="text-muted-foreground text-xs font-medium">{label}</legend>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="decimal"
          step={step}
          min={0}
          aria-label={`${label} ${t('filters.min')}`}
          placeholder={t('filters.min')}
          value={values[min] ?? ''}
          onChange={(e) => set(min, e.target.value)}
          className="h-8"
        />
        <Input
          type="number"
          inputMode="decimal"
          step={step}
          min={0}
          aria-label={`${label} ${t('filters.max')}`}
          placeholder={t('filters.max')}
          value={values[max] ?? ''}
          onChange={(e) => set(max, e.target.value)}
          className="h-8"
        />
      </div>
    </fieldset>
  );

  return (
    <div className="space-y-3">
      <Button variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <SlidersHorizontal aria-hidden /> {t('filters.title')}
        {active > 0 && <Badge variant="default">{t('filters.active', { count: active })}</Badge>}
      </Button>
      {open && (
        <form onSubmit={submit} className="border-border bg-card space-y-4 rounded-lg border p-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {range(t('filters.volume'), 'minVolume', 'maxVolume')}
            {range(t('filters.kd'), 'minKd', 'maxKd')}
            {range(t('filters.cpc'), 'minCpc', 'maxCpc', '0.01')}
            {range(t('filters.words'), 'minWords', 'maxWords')}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="text-muted-foreground space-y-1.5 text-xs font-medium">
              {t('filters.include')}
              <Input
                value={values.include ?? ''}
                onChange={(e) => set('include', e.target.value)}
                placeholder={t('filters.includePlaceholder')}
                className="h-8"
              />
            </label>
            <label className="text-muted-foreground space-y-1.5 text-xs font-medium">
              {t('filters.exclude')}
              <Input
                value={values.exclude ?? ''}
                onChange={(e) => set('exclude', e.target.value)}
                placeholder={t('filters.excludePlaceholder')}
                className="h-8"
              />
            </label>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-muted-foreground text-xs font-medium">
              {t('filters.intent')}
            </legend>
            <div className="flex flex-wrap gap-2">
              {INTENTS.map((i) => (
                <label
                  key={i}
                  className="border-border flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-primary)]"
                    checked={csvSet(values.intents).has(i)}
                    onChange={() => toggleCsv('intents', i)}
                  />
                  {t(`intents.${i}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-1.5">
            <legend className="text-muted-foreground text-xs font-medium">
              {t('filters.features')}
            </legend>
            <div className="flex flex-wrap gap-2">
              {SERP_FEATURES.map((f) => (
                <label
                  key={f}
                  className="border-border flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-primary)]"
                    checked={csvSet(values.features).has(f)}
                    onChange={() => toggleCsv('features', f)}
                  />
                  {t(`features.${f}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              {t('filters.apply')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={reset}>
              {t('filters.reset')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
