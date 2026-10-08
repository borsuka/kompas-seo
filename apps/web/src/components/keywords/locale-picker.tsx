'use client';
import { useTranslations } from 'next-intl';
import { findLocation, LANGUAGES, LOCATIONS } from '@seo/shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@seo/ui/select';

/** Country + language for keyword research (Google Ads location codes). */
export function LocalePicker({
  loc,
  lang,
  onChange,
}: {
  loc: number;
  lang: string;
  onChange: (loc: number, lang: string) => void;
}) {
  const t = useTranslations();
  return (
    <div className="flex gap-2">
      <Select
        value={String(loc)}
        onValueChange={(v) => onChange(Number(v), findLocation(Number(v))?.defaultLanguage ?? lang)}
      >
        <SelectTrigger className="w-40" aria-label={t('keywords.country')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LOCATIONS.map((l) => (
            <SelectItem key={l.code} value={String(l.code)}>
              {t(`countries.${l.iso}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={lang} onValueChange={(v) => onChange(loc, v)}>
        <SelectTrigger className="w-36" aria-label={t('keywords.language')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LANGUAGES.map((l) => (
            <SelectItem key={l} value={l}>
              {t(`languages.${l}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
