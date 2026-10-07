import { describe, expect, it } from 'vitest';
import { baseCtr, ctr, DEFAULT_CTR_CONFIG } from './ctr.js';
import { calibrationFactor, domainTraffic, keywordTraffic, trafficByUrl } from './traffic.js';

describe('CTR curve', () => {
  it('uses the configured values for positions 1–10', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((p) => baseCtr(p))).toEqual(
      DEFAULT_CTR_CONFIG.top10,
    );
  });

  it('decreases smoothly and strictly from 10 to 100', () => {
    let prev = baseCtr(10);
    for (let p = 11; p <= 100; p++) {
      const v = baseCtr(p);
      expect(v).toBeLessThan(prev);
      prev = v;
    }
    expect(baseCtr(100)).toBeCloseTo(DEFAULT_CTR_CONFIG.ctrAt100, 6);
  });

  it('is zero outside 1–100', () => {
    expect(baseCtr(0)).toBe(0);
    expect(baseCtr(101)).toBe(0);
    expect(baseCtr(Number.NaN)).toBe(0);
  });

  it('applies SERP feature adjustments multiplicatively', () => {
    expect(ctr(1, { aiOverview: true })).toBeCloseTo(0.28 * 0.7);
    expect(ctr(1, { featuredSnippetOtherDomain: true })).toBeCloseTo(0.28 * 0.85);
    expect(ctr(1, { topAds: 2 })).toBeCloseTo(0.28);
    expect(ctr(1, { topAds: 3 })).toBeCloseTo(0.28 * 0.9);
    expect(ctr(2, { aiOverview: true, featuredSnippetOtherDomain: true, topAds: 4 })).toBeCloseTo(
      0.15 * 0.7 * 0.85 * 0.9,
    );
  });
});

describe('traffic estimation', () => {
  const rows = [
    { keyword: 'a', url: 'https://x.bg/a', volume: 1000, position: 1 },
    { keyword: 'b', url: 'https://x.bg/a', volume: 500, position: 3, serp: { aiOverview: true } },
    { keyword: 'c', url: 'https://x.bg/c', volume: 200, position: 10 },
    { keyword: 'd', url: 'https://x.bg/c', volume: 0, position: 1 },
  ];

  it('computes keyword, URL and domain traffic', () => {
    expect(keywordTraffic(rows[0]!)).toBeCloseTo(280);
    const byUrl = trafficByUrl(rows);
    expect(byUrl.get('https://x.bg/a')).toBeCloseTo(280 + 500 * 0.1 * 0.7);
    expect(byUrl.get('https://x.bg/c')).toBeCloseTo(200 * 0.018);
    expect(domainTraffic(rows)).toBeCloseTo(280 + 35 + 3.6);
  });

  it('calibrates against real clicks with clamping and a reliability flag', () => {
    const pairs = Array.from({ length: 25 }, () => ({ estimatedClicks: 100, actualClicks: 50 }));
    expect(calibrationFactor(pairs)).toEqual({ factor: 0.5, sampleSize: 25, reliable: true });
    expect(calibrationFactor(pairs.slice(0, 3)).reliable).toBe(false);
    expect(calibrationFactor([{ estimatedClicks: 1, actualClicks: 1000 }]).factor).toBe(10);
    expect(calibrationFactor([]).factor).toBe(1);
  });
});
