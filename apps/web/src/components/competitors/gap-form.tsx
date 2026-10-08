'use client';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { normalizeDomain } from '@seo/shared';
import { Button } from '@seo/ui/button';
import { Input } from '@seo/ui/input';
import { Label } from '@seo/ui/label';
import { useCurrentProject } from '@/components/app-shell/project-context';
import { LocalePicker } from '@/components/keywords/locale-picker';
import { useCompetitors } from '@/lib/queries';
import { useSearchState } from '@/lib/use-search-state';

export const GAP_MAX_COMPETITORS = 4;

/**
 * Target + competitors of a gap analysis. URL params win; otherwise the active
 * project's domain and its tracked competitors are suggested.
 */
export function useGapParams() {
  const { current } = useCurrentProject();
  const tracked = useCompetitors(current?.id);
  const { params, set } = useSearchState();
  const target = params.target ?? current?.domain ?? '';
  const competitors = params.competitors
    ? params.competitors.split(',').filter(Boolean)
    : (tracked.data ?? []).map((c) => c.domain).slice(0, GAP_MAX_COMPETITORS);
  const loc = Number(params.loc ?? current?.locationCode ?? 2100);
  const lang = params.lang ?? current?.languageCode ?? 'bg';
  /** Only run once the user confirmed the domains (explicit URL params). */
  const confirmed = !!params.target && !!params.competitors;
  return { target, competitors, loc, lang, confirmed, params, set };
}

export function GapForm({ showLocale = true }: { showLocale?: boolean } = {}) {
  const t = useTranslations('competitors.gapForm');
  const { target, competitors, loc, lang, set } = useGapParams();
  const [you, setYou] = useState(target);
  const [rivals, setRivals] = useState<string[]>(() =>
    Array.from({ length: GAP_MAX_COMPETITORS }, (_, i) => competitors[i] ?? ''),
  );
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const tgt = normalizeDomain(you);
    const comps = [
      ...new Set(
        rivals
          .filter((r) => r.trim())
          .map((r) => normalizeDomain(r))
          .filter((r): r is string => !!r && r !== tgt),
      ),
    ];
    if (!tgt) return setError(t('invalidTarget'));
    if (!comps.length) return setError(t('needCompetitor'));
    setError(null);
    set(
      showLocale
        ? { target: tgt, competitors: comps.join(','), loc, lang }
        : { target: tgt, competitors: comps.join(',') },
    );
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="border-border mb-4 space-y-3 rounded-lg border p-4"
    >
      <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
        <div className="space-y-1.5">
          <Label htmlFor="gap-target">{t('target')}</Label>
          <Input
            id="gap-target"
            value={you}
            onChange={(e) => setYou(e.target.value)}
            placeholder={t('targetPlaceholder')}
          />
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">{t('competitors')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {rivals.map((r, i) => (
              <Input
                key={i}
                value={r}
                onChange={(e) => setRivals((s) => s.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={t('competitorPlaceholder', { n: i + 1 })}
                aria-label={t('competitorPlaceholder', { n: i + 1 })}
              />
            ))}
          </div>
        </fieldset>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {showLocale ? (
          <LocalePicker loc={loc} lang={lang} onChange={(l, lg) => set({ loc: l, lang: lg })} />
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3">
          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
          <Button type="submit">{t('compare')}</Button>
        </div>
      </div>
    </form>
  );
}
