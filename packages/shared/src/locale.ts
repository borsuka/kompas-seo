import { z } from 'zod';

/**
 * Locations use Google Ads geotarget criteria IDs, which DataForSEO also uses.
 * For countries this is 2000 + ISO 3166-1 numeric code (Bulgaria = 2100).
 */
export const LOCATIONS = [
  { code: 2100, iso: 'BG', defaultLanguage: 'bg' },
  { code: 2840, iso: 'US', defaultLanguage: 'en' },
  { code: 2826, iso: 'GB', defaultLanguage: 'en' },
  { code: 2372, iso: 'IE', defaultLanguage: 'en' },
  { code: 2276, iso: 'DE', defaultLanguage: 'de' },
  { code: 2040, iso: 'AT', defaultLanguage: 'de' },
  { code: 2250, iso: 'FR', defaultLanguage: 'fr' },
  { code: 2056, iso: 'BE', defaultLanguage: 'nl' },
  { code: 2528, iso: 'NL', defaultLanguage: 'nl' },
  { code: 2380, iso: 'IT', defaultLanguage: 'it' },
  { code: 2724, iso: 'ES', defaultLanguage: 'es' },
  { code: 2620, iso: 'PT', defaultLanguage: 'pt' },
  { code: 2616, iso: 'PL', defaultLanguage: 'pl' },
  { code: 2642, iso: 'RO', defaultLanguage: 'ro' },
  { code: 2300, iso: 'GR', defaultLanguage: 'el' },
  { code: 2203, iso: 'CZ', defaultLanguage: 'cs' },
  { code: 2703, iso: 'SK', defaultLanguage: 'sk' },
  { code: 2348, iso: 'HU', defaultLanguage: 'hu' },
  { code: 2191, iso: 'HR', defaultLanguage: 'hr' },
  { code: 2705, iso: 'SI', defaultLanguage: 'sl' },
  { code: 2688, iso: 'RS', defaultLanguage: 'sr' },
  { code: 2807, iso: 'MK', defaultLanguage: 'mk' },
  { code: 2752, iso: 'SE', defaultLanguage: 'sv' },
  { code: 2208, iso: 'DK', defaultLanguage: 'da' },
  { code: 2246, iso: 'FI', defaultLanguage: 'fi' },
] as const;

export const LANGUAGES = [
  'bg',
  'en',
  'de',
  'fr',
  'nl',
  'it',
  'es',
  'pt',
  'pl',
  'ro',
  'el',
  'cs',
  'sk',
  'hu',
  'hr',
  'sl',
  'sr',
  'mk',
  'sv',
  'da',
  'fi',
] as const;

export type LocationCode = (typeof LOCATIONS)[number]['code'];
export type LanguageCode = (typeof LANGUAGES)[number];

const locationCodes = LOCATIONS.map((l) => l.code) as number[];

export const locationCodeSchema = z
  .number()
  .int()
  .refine((c) => locationCodes.includes(c), { message: 'Unsupported location' });

export const languageCodeSchema = z.enum(LANGUAGES);

export const localeSchema = z.object({
  locationCode: locationCodeSchema,
  languageCode: languageCodeSchema,
});
export type Locale = z.infer<typeof localeSchema>;

export const DEFAULT_LOCALE: Locale = { locationCode: 2100, languageCode: 'bg' };

export const deviceSchema = z.enum(['desktop', 'mobile']);
export type Device = z.infer<typeof deviceSchema>;

export function findLocation(code: number) {
  return LOCATIONS.find((l) => l.code === code);
}

/** UI languages (next-intl). Data languages are a separate, larger set. */
export const UI_LOCALES = ['bg', 'en'] as const;
export type UiLocale = (typeof UI_LOCALES)[number];
export const DEFAULT_UI_LOCALE: UiLocale = 'bg';
