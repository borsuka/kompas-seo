'use client';
import { useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';

/**
 * Table state (filters, sorting, paging, tabs) lives in the URL so views can be
 * shared, bookmarked and survive reloads.
 */
export function useSearchState() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const params = useMemo(
    () => Object.fromEntries(search.entries()) as Record<string, string>,
    [search],
  );

  const set = useCallback(
    (
      patch: Record<string, string | number | null | undefined>,
      opts: { resetPage?: boolean } = {},
    ) => {
      const next = new URLSearchParams(search.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '') next.delete(k);
        else next.set(k, String(v));
      }
      if (opts.resetPage !== false && !('page' in patch)) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [search, router, pathname],
  );

  return { params, set };
}
