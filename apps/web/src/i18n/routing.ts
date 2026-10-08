import { defineRouting } from 'next-intl/routing';
import { DEFAULT_UI_LOCALE, UI_LOCALES } from '@seo/shared';

export const routing = defineRouting({
  locales: UI_LOCALES,
  defaultLocale: DEFAULT_UI_LOCALE,
  // Bulgarian (default) has no prefix: /app; English lives under /en/app.
  localePrefix: 'as-needed',
  // Bulgarian is the product default: don't redirect by browser language;
  // English is chosen explicitly (switcher or /en URLs).
  localeDetection: false,
});
