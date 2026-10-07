import { z } from 'zod';

/** Canonical keyword form used as a storage and cache key. Works for Cyrillic. */
export function normalizeKeyword(input: string): string {
  // `\s` covers NBSP and other Unicode spaces.
  return input.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function wordCount(keyword: string): number {
  const k = keyword.trim();
  return k ? k.split(/\s+/).length : 0;
}

export const keywordSchema = z
  .string()
  .max(200)
  .transform(normalizeKeyword)
  .pipe(z.string().min(1, 'Keyword is required'));
