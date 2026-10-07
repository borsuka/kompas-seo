import { describe, expect, it } from 'vitest';
import { keywordSchema, normalizeKeyword, wordCount } from './keyword.js';

describe('normalizeKeyword', () => {
  it('lowercases Cyrillic and collapses whitespace', () => {
    expect(normalizeKeyword('  SEO   Оптимизация София ')).toBe('seo оптимизация софия');
  });

  it('applies NFC so composed and decomposed forms match', () => {
    // "й" as "и" + combining breve vs the precomposed letter
    expect(normalizeKeyword('й')).toBe(normalizeKeyword('й'));
  });

  it('counts words', () => {
    expect(wordCount('seo оптимизация софия')).toBe(3);
    expect(wordCount('')).toBe(0);
  });

  it('rejects empty keywords', () => {
    expect(keywordSchema.safeParse('   ').success).toBe(false);
    expect(keywordSchema.parse(' Купи Обувки ')).toBe('купи обувки');
  });
});
