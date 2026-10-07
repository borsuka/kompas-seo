'use client';
import { Languages } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { UI_LOCALES, type UiLocale } from '@seo/shared';
import { Button } from '@seo/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@seo/ui/dropdown-menu';
import { usePathname, useRouter } from '@/i18n/navigation';

/** Language names are shown in their own language on purpose (not translated). */
const NATIVE_NAMES: Record<UiLocale, string> = { bg: 'Български', en: 'English' };

export function LocaleSwitcher() {
  const t = useTranslations('shell');
  const locale = useLocale() as UiLocale;
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('language')}>
          <Languages aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('language')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(next) =>
            startTransition(() => {
              const qs = search.toString();
              router.replace(qs ? `${pathname}?${qs}` : pathname, { locale: next as UiLocale });
            })
          }
        >
          {UI_LOCALES.map((l) => (
            <DropdownMenuRadioItem key={l} value={l} lang={l}>
              {NATIVE_NAMES[l]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
