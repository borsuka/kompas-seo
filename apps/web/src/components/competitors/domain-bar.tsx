'use client';
import { Globe } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { normalizeDomain } from '@seo/shared';
import { Button } from '@seo/ui/button';
import { Input } from '@seo/ui/input';
import { useCurrentProject } from '@/components/app-shell/project-context';
import { LocalePicker } from '@/components/keywords/locale-picker';
import { useSearchState } from '@/lib/use-search-state';

/** Domain + market currently analysed: URL params first, then the active project. */
export function useDomainParams() {
  const { current } = useCurrentProject();
  const { params, set } = useSearchState();
  const domain = params.domain ?? current?.domain ?? '';
  const loc = Number(params.loc ?? current?.locationCode ?? 2100);
  const lang = params.lang ?? current?.languageCode ?? 'bg';
  return { domain, loc, lang, params, set };
}

export function DomainBar() {
  const t = useTranslations('competitors');
  const { domain, loc, lang, set } = useDomainParams();
  const [input, setInput] = useState(domain);
  const [invalid, setInvalid] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    const d = normalizeDomain(input);
    setInvalid(!d);
    if (d) set({ domain: d, loc, lang });
  }

  return (
    <form onSubmit={submit} className="mb-4 flex flex-col gap-2 lg:flex-row" noValidate>
      <div className="relative flex-1">
        <Globe
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('domainPlaceholder')}
          aria-label={t('domainLabel')}
          aria-invalid={invalid || undefined}
          className="h-10 pl-9"
        />
        {invalid && (
          <p className="text-destructive mt-1 text-xs" role="alert">
            {t('invalidDomain')}
          </p>
        )}
      </div>
      <LocalePicker loc={loc} lang={lang} onChange={(l, lg) => set({ loc: l, lang: lg })} />
      <Button type="submit" className="h-10" disabled={!input.trim()}>
        {t('analyze')}
      </Button>
    </form>
  );
}
