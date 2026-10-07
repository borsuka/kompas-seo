import { describe, expect, it } from 'vitest';
import bg from '../../messages/bg.json';
import en from '../../messages/en.json';

function keys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object'
      ? keys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

function placeholders(msg: string): string[] {
  // `{name}` or `{name, plural, …}`; plural branch texts like `{None added}` are not placeholders.
  return [...msg.matchAll(/\{(\w+)\s*[},]/g)].map((m) => m[1]!).sort();
}

describe('UI translations', () => {
  it('bg and en define exactly the same keys', () => {
    expect(keys(en).sort()).toEqual(keys(bg).sort());
  });

  it('bg and en use the same placeholders in every message', () => {
    const flat = (o: Record<string, unknown>, p = ''): [string, string][] =>
      Object.entries(o).flatMap(([k, v]) =>
        v && typeof v === 'object'
          ? flat(v as Record<string, unknown>, `${p}${k}.`)
          : [[`${p}${k}`, String(v)]],
      );
    const enMap = new Map(flat(en));
    for (const [key, value] of flat(bg)) {
      expect(placeholders(value), key).toEqual(placeholders(enMap.get(key) ?? ''));
    }
  });

  it('has no empty messages', () => {
    const values = (o: Record<string, unknown>): string[] =>
      Object.values(o).flatMap((v) =>
        v && typeof v === 'object' ? values(v as Record<string, unknown>) : [String(v)],
      );
    expect(values(bg).filter((v) => !v.trim())).toEqual([]);
    expect(values(en).filter((v) => !v.trim())).toEqual([]);
  });
});
