/** Deterministic pseudo-random helpers. The same seed string always yields the same data. */

/** FNV-1a 32-bit hash. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Rng {
  /** Uniform [0, 1). */
  next(): number;
  int(min: number, max: number): number;
  float(min: number, max: number): number;
  bool(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Standard normal via Box–Muller. */
  normal(): number;
  shuffle<T>(items: readonly T[]): T[];
}

/** mulberry32 — tiny, fast, good enough for fake data. */
export function createRng(seed: string | number): Rng {
  let a = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    float: (min, max) => min + next() * (max - min),
    bool: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)]!,
    normal: () => {
      const u = Math.max(next(), Number.EPSILON);
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
  };
  return rng;
}

/** Google Ads style volume buckets, so mock volumes look like real ones. */
const VOLUME_BUCKETS = [
  0, 10, 20, 30, 40, 50, 70, 90, 110, 140, 170, 210, 260, 320, 390, 480, 590, 720, 880, 1000, 1300,
  1600, 1900, 2400, 2900, 3600, 4400, 5400, 6600, 8100, 9900, 12100, 14800, 18100, 22200, 27100,
  33100, 40500, 49500, 60500, 74000, 90500, 110000, 135000, 165000, 201000, 246000, 301000, 368000,
  450000, 550000, 673000, 823000, 1000000,
];

export function toVolumeBucket(value: number): number {
  let best = 0;
  for (const b of VOLUME_BUCKETS) {
    if (Math.abs(b - value) < Math.abs(best - value)) best = b;
  }
  return best;
}

export function slugify(text: string): string {
  const map: Record<string, string> = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'y',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'ts',
    ч: 'ch',
    ш: 'sh',
    щ: 'sht',
    ъ: 'a',
    ь: 'y',
    ю: 'yu',
    я: 'ya',
  };
  return text
    .toLowerCase()
    .split('')
    .map((c) => map[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
