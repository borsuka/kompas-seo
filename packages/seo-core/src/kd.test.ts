import { describe, expect, it } from 'vitest';
import { keywordDifficulty, normalizeKd, weightedMedian } from './kd.js';

const top10 = (refDomains: number[], rating?: number) =>
  refDomains.map((r, i) => ({ position: i + 1, referringDomains: r, domainRating: rating }));

describe('weightedMedian', () => {
  it('returns the median with weights', () => {
    expect(
      weightedMedian([
        { value: 1, weight: 1 },
        { value: 2, weight: 1 },
        { value: 3, weight: 1 },
      ]),
    ).toBe(2);
    expect(
      weightedMedian([
        { value: 1, weight: 5 },
        { value: 100, weight: 1 },
      ]),
    ).toBe(1);
    expect(weightedMedian([])).toBe(0);
  });
});

describe('KD normalization', () => {
  it('hits the calibration anchors (0≈0, 10≈30, 100≈60, 1000≈90)', () => {
    expect(normalizeKd(0)).toBe(0);
    expect(Math.abs(normalizeKd(10) - 30)).toBeLessThanOrEqual(2);
    expect(Math.abs(normalizeKd(100) - 60)).toBeLessThanOrEqual(2);
    expect(Math.abs(normalizeKd(1000) - 90)).toBeLessThanOrEqual(2);
    expect(normalizeKd(1e9)).toBe(100);
  });

  it('is monotonic', () => {
    let prev = -1;
    for (const m of [0, 1, 5, 10, 50, 100, 500, 1000, 5000]) {
      const kd = normalizeKd(m);
      expect(kd).toBeGreaterThanOrEqual(prev);
      prev = kd;
    }
  });
});

describe('keywordDifficulty', () => {
  it('weights the top 3 more than positions 4–10', () => {
    const strongTop = keywordDifficulty(top10([1000, 1000, 1000, 1000, 5, 5, 5, 5, 5, 5]))!;
    const strongTail = keywordDifficulty(top10([5, 5, 5, 5, 5, 5, 1000, 1000, 1000, 1000]))!;
    expect(strongTop).toBeGreaterThan(strongTail);
  });

  it('adds a bounded correction for the average domain rating', () => {
    const base = keywordDifficulty(top10(Array(10).fill(100)))!;
    expect(keywordDifficulty(top10(Array(10).fill(100), 100))).toBe(base + 5);
    expect(keywordDifficulty(top10(Array(10).fill(100), 0))).toBe(base - 5);
    expect(keywordDifficulty(top10(Array(10).fill(100), 50))).toBe(base);
  });

  it('ignores positions outside the top 10 and returns null without data', () => {
    expect(keywordDifficulty([{ position: 15, referringDomains: 5000 }])).toBeNull();
    expect(keywordDifficulty(top10([0, 0, 0]))).toBe(0);
  });
});
