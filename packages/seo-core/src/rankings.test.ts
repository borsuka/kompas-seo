import { describe, expect, it } from 'vitest';
import {
  alertTriggered,
  averagePosition,
  findDomainPosition,
  positionChange,
  positionDistribution,
  serpVolatility,
  shareOfVoice,
  visibility,
} from './rankings.js';

const urls = (prefix: string, n = 10) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

describe('visibility', () => {
  it('is 100 % when ranking #1 everywhere and 0 % when unranked', () => {
    expect(
      visibility([
        { position: 1, volume: 1000 },
        { position: 1, volume: 10 },
      ]),
    ).toBe(100);
    expect(visibility([{ position: null, volume: 1000 }])).toBe(0);
    expect(visibility([])).toBe(0);
  });

  it('weights keywords by volume and decreases with position', () => {
    const high = visibility([
      { position: 1, volume: 1000 },
      { position: null, volume: 10 },
    ]);
    const low = visibility([
      { position: null, volume: 1000 },
      { position: 1, volume: 10 },
    ]);
    expect(high).toBeGreaterThan(90);
    expect(low).toBeLessThan(2);
    expect(visibility([{ position: 3, volume: 100 }])).toBeGreaterThan(
      visibility([{ position: 8, volume: 100 }]),
    );
  });
});

describe('distribution and averages', () => {
  it('builds cumulative buckets', () => {
    expect(positionDistribution([1, 2, 5, 15, 40, 99, null, 101])).toEqual({
      top3: 2,
      top10: 3,
      top20: 4,
      top50: 5,
      top100: 6,
      notRanked: 2,
    });
  });

  it('averages ranked positions only', () => {
    expect(averagePosition([1, 4, null])).toBe(2.5);
    expect(averagePosition([null])).toBeNull();
  });

  it('computes position change (positive = up)', () => {
    expect(positionChange(10, 4)).toBe(6);
    expect(positionChange(4, 10)).toBe(-6);
    expect(positionChange(null, 4)).toBeNull();
  });
});

describe('shareOfVoice', () => {
  it('splits expected clicks between domains and sums to 1', () => {
    const sov = shareOfVoice(
      new Map([
        [
          'me.bg',
          [
            { position: 1, volume: 100 },
            { position: null, volume: 100 },
          ],
        ],
        [
          'rival.bg',
          [
            { position: 2, volume: 100 },
            { position: 1, volume: 100 },
          ],
        ],
      ]),
    );
    expect(sov.get('rival.bg')!).toBeGreaterThan(sov.get('me.bg')!);
    expect(sov.get('me.bg')! + sov.get('rival.bg')!).toBeCloseTo(1, 2);
  });

  it('returns zeros when nobody ranks', () => {
    const sov = shareOfVoice(new Map([['me.bg', [{ position: null, volume: 10 }]]]));
    expect(sov.get('me.bg')).toBe(0);
  });
});

describe('serpVolatility', () => {
  it('is 0 for an unchanged SERP and 10 for a completely new one', () => {
    expect(serpVolatility(urls('a'), urls('a'))).toBe(0);
    expect(serpVolatility(urls('a'), urls('b'))).toBe(10);
    expect(serpVolatility([], urls('a'))).toBe(0);
  });

  it('grows with the amount of movement', () => {
    const swap = [...urls('a')];
    [swap[0], swap[1]] = [swap[1]!, swap[0]!];
    const halfNew = [...urls('a', 5), ...urls('b', 5)];
    const small = serpVolatility(urls('a'), swap);
    const large = serpVolatility(urls('a'), halfNew);
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeLessThan(10);
  });
});

describe('findDomainPosition', () => {
  const organic = [
    { domain: 'wikipedia.org', url: 'https://wikipedia.org/x', position: 1 },
    { domain: 'blog.me.bg', url: 'https://blog.me.bg/a', position: 2 },
    { domain: 'www.me.bg', url: 'https://www.me.bg/', position: 5 },
  ];
  it('matches the domain and its subdomains, first hit wins', () => {
    expect(findDomainPosition(organic, 'me.bg')).toEqual({
      position: 2,
      url: 'https://blog.me.bg/a',
    });
    expect(findDomainPosition(organic, 'notme.bg')).toBeNull();
    // A different domain that merely ends with the same letters must not match.
    expect(findDomainPosition([{ domain: 'some.bg', url: 'u', position: 1 }], 'me.bg')).toBeNull();
  });
});

describe('alertTriggered', () => {
  const rule = (type: Parameters<typeof alertTriggered>[0]['type'], threshold: number) => ({
    id: 'r',
    type,
    threshold,
  });
  it('detects drops and gains by at least N positions', () => {
    expect(alertTriggered(rule('position_drop', 3), 4, 7)).toBe(true);
    expect(alertTriggered(rule('position_drop', 3), 4, 6)).toBe(false);
    expect(alertTriggered(rule('position_drop', 5), 10, null)).toBe(true);
    expect(alertTriggered(rule('position_gain', 5), null, 20)).toBe(true);
  });

  it('detects entering and leaving the top N', () => {
    expect(alertTriggered(rule('enter_top', 10), 12, 9)).toBe(true);
    expect(alertTriggered(rule('enter_top', 10), 9, 8)).toBe(false);
    expect(alertTriggered(rule('leave_top', 3), 3, 4)).toBe(true);
    expect(alertTriggered(rule('leave_top', 3), 2, null)).toBe(true);
    expect(alertTriggered(rule('leave_top', 3), null, null)).toBe(false);
  });
});
