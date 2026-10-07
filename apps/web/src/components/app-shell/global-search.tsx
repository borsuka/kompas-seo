'use client';
import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { looksLikeDomain, normalizeDomain, normalizeKeyword } from '@seo/shared';
import { Input } from '@seo/ui/input';
import { useRouter } from '@/i18n/navigation';

/** One box for both: a domain opens the domain overview, anything else the keyword overview. */
export function GlobalSearch() {
  const t = useTranslations('shell');
  const router = useRouter();
  const [query, setQuery] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (looksLikeDomain(q)) {
      router.push(`/app/competitors?domain=${encodeURIComponent(normalizeDomain(q) ?? q)}`);
    } else {
      router.push(`/app/keywords?q=${encodeURIComponent(normalizeKeyword(q))}`);
    }
  }

  return (
    <form role="search" onSubmit={onSubmit} className="relative w-full max-w-md">
      <Search
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        aria-hidden
      />
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('searchPlaceholder')}
        aria-label={t('searchLabel')}
        className="pl-9"
      />
    </form>
  );
}
