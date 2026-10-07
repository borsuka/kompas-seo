import { describe, expect, it } from 'vitest';
import { domainSchema, looksLikeDomain, normalizeDomain } from './domain.js';

describe('normalizeDomain', () => {
  it.each([
    ['Example.com', 'example.com'],
    ['https://www.example.com/path?q=1', 'example.com'],
    ['http://shop.example.co.uk:8080/', 'shop.example.co.uk'],
    ['example.com.', 'example.com'],
    ['  WWW.Example.BG  ', 'example.bg'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it('converts Cyrillic IDNs to punycode', () => {
    expect(normalizeDomain('пример.бг')).toBe('xn--e1afmkfd.xn--90ae');
    expect(normalizeDomain('https://www.пример.бг/страница')).toBe('xn--e1afmkfd.xn--90ae');
  });

  it.each([
    '',
    'localhost',
    '192.168.0.1',
    'http://[::1]/',
    'not a domain',
    'exa_mple.com',
    '-bad.com',
    'foo.123',
  ])('rejects %j', (input) => {
    expect(normalizeDomain(input)).toBeNull();
  });
});

describe('looksLikeDomain', () => {
  it('distinguishes keywords from domains', () => {
    expect(looksLikeDomain('seo оптимизация')).toBe(false);
    expect(looksLikeDomain('seo')).toBe(false);
    expect(looksLikeDomain('example.com')).toBe(true);
    expect(looksLikeDomain('https://example.com/page')).toBe(true);
    expect(looksLikeDomain('пример.бг')).toBe(true);
  });
});

describe('domainSchema', () => {
  it('parses and normalizes', () => {
    expect(domainSchema.parse('https://www.Example.com')).toBe('example.com');
    expect(domainSchema.safeParse('nope').success).toBe(false);
  });
});
