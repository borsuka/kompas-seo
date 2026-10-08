import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Crawler, MemoryRobotsCache } from './crawler.js';
import { countWords, extractPage } from './extract.js';
import { assertFetchableUrl, BlockedUrlError, isBlockedAddress } from './network.js';
import { isAllowed, parseRobots } from './robots.js';
import { FetchFailedError, safeFetch } from './safe-fetch.js';

describe('SSRF protection', () => {
  it('blocks private, loopback, link-local, metadata and reserved addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '64:ff9b::7f00:1',
      'not-an-ip',
    ])
      expect(isBlockedAddress(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '93.184.216.34', '2a00:1450:4001:82a::200e', '::ffff:8.8.8.8'])
      expect(isBlockedAddress(ip), ip).toBe(false);
  });

  it('rejects non-http protocols, credentials, odd ports and internal host names', () => {
    for (const url of [
      'file:///etc/passwd',
      'ftp://example.com/',
      'http://user:pass@example.com/',
      'http://example.com:8080/',
      'http://localhost/',
      'http://metadata.google.internal/',
      'http://127.0.0.1/',
      'http://[::1]/',
      'http://169.254.169.254/latest/meta-data/',
    ])
      expect(() => assertFetchableUrl(url), url).toThrow(BlockedUrlError);
    expect(assertFetchableUrl('https://example.bg/път?x=1').hostname).toBe('example.bg');
  });
});

describe('robots.txt', () => {
  const robots = `
User-agent: *
Disallow: /private/
Allow: /private/public-page
Disallow: /*.pdf$
Crawl-delay: 2

User-agent: KompasSEOBot
User-agent: OtherBot
Disallow: /no-kompas/

Sitemap: https://example.bg/sitemap.xml
`;
  it('uses the most specific group, longest match wins and Allow wins ties', () => {
    const ours = parseRobots(robots, 'KompasSEOBot/1.0');
    expect(isAllowed(ours, '/no-kompas/x')).toBe(false);
    // Our specific group replaces "*": /private/ is allowed for us.
    expect(isAllowed(ours, '/private/x')).toBe(true);
    expect(ours.sitemaps).toEqual(['https://example.bg/sitemap.xml']);

    const generic = parseRobots(robots, 'SomeBot/2.0');
    expect(isAllowed(generic, '/private/x')).toBe(false);
    expect(isAllowed(generic, '/private/public-page')).toBe(true);
    expect(isAllowed(generic, '/files/a.pdf')).toBe(false);
    expect(isAllowed(generic, '/files/a.pdf?x=1')).toBe(true);
    expect(isAllowed(generic, '/')).toBe(true);
    expect(generic.crawlDelaySec).toBe(2);
    expect(isAllowed(parseRobots('User-agent: *\nDisallow: /', 'X'), '/robots.txt')).toBe(true);
    expect(isAllowed(parseRobots('User-agent: *\nDisallow:', 'X'), '/anything')).toBe(true);
  });
});

describe('extractPage', () => {
  it('extracts title, meta, headings, main text, links, images and JSON-LD types', () => {
    const page = extractPage(
      `<!doctype html><html lang="bg"><head>
        <title> Зъболекар в София | Клиника </title>
        <meta name="description" content="Модерна   дентална клиника">
        <meta name="robots" content="index,follow">
        <link rel="canonical" href="/zabolekar">
        <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Dentist"},{"@type":["FAQPage"]}]}</script>
      </head><body>
        <nav>Меню Начало Контакти</nav>
        <main>
          <h1>Зъболекар София</h1>
          <p>Предлагаме избелване на зъби и импланти.</p>
          <h2>Цени</h2><p>От 50 лв.</p>
          <h3>Импланти</h3>
          <a href="/ceni">Цени</a><a href="https://other.bg/">Партньор</a><a href="#top">Нагоре</a>
          <img src="a.jpg" alt="Клиника"><img src="b.jpg">
          <script>var hidden = "не се брои";</script>
        </main>
        <footer>Всички права запазени</footer>
      </body></html>`,
      'https://www.clinic.bg/page',
    );
    expect(page).toMatchObject({
      lang: 'bg',
      title: 'Зъболекар в София | Клиника',
      metaDescription: 'Модерна дентална клиника',
      canonical: 'https://www.clinic.bg/zabolekar',
      noindex: false,
      h1: ['Зъболекар София'],
      headings: [
        { level: 2, text: 'Цени' },
        { level: 3, text: 'Импланти' },
      ],
      links: { internal: 1, external: 1 },
      images: { total: 2, withoutAlt: 1 },
      schemaTypes: ['Dentist', 'FAQPage'],
    });
    expect(page.text).toContain('избелване на зъби');
    expect(page.text).not.toContain('Меню');
    expect(page.text).not.toContain('не се брои');
    expect(page.text).not.toContain('права запазени');
    expect(page.wordCount).toBeGreaterThan(10);
  });

  it('counts words in Cyrillic and Latin text', () => {
    expect(countWords('Зъболекар в София – цени 2026, e-mail и т.н.')).toBe(9);
  });
});

describe('safeFetch and Crawler (local test server)', () => {
  let server: http.Server;
  let base = '';
  const big = 'x'.repeat(200_000);

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      switch (req.url) {
        case '/robots.txt':
          res.writeHead(200, { 'content-type': 'text/plain' });
          return res.end('User-agent: *\nDisallow: /secret');
        case '/page':
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'content-encoding': 'gzip',
          });
          return res.end(
            gzipSync(
              '<html><head><title>Тест</title></head><body><main><h1>Здравей</h1><p>свят</p></main></body></html>',
            ),
          );
        case '/to-secret':
          res.writeHead(301, { location: '/secret' });
          return res.end();
        case '/redirect':
          res.writeHead(301, { location: '/page' });
          return res.end();
        case '/loop':
          res.writeHead(302, { location: '/loop' });
          return res.end();
        case '/big':
          res.writeHead(200, { 'content-type': 'text/html' });
          return res.end(big);
        case '/pdf':
          res.writeHead(200, { 'content-type': 'application/pdf' });
          return res.end('%PDF');
        case '/secret':
          res.writeHead(200, { 'content-type': 'text/html' });
          return res.end('<p>secret</p>');
        default:
          res.writeHead(404, { 'content-type': 'text/html' });
          return res.end('nope');
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const local = { unsafeAllowPrivateNetworks: true, timeoutMs: 5000 };

  it('refuses local targets unless explicitly allowed (tests only)', async () => {
    await expect(safeFetch(`${base}/page`)).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it('follows redirects, decompresses and enforces limits and content types', async () => {
    const res = await safeFetch(`${base}/redirect`, local);
    expect(res.url).toBe(`${base}/page`);
    expect(res.redirects).toEqual([`${base}/page`]);
    expect(res.body).toContain('Здравей');
    await expect(safeFetch(`${base}/loop`, { ...local, maxRedirects: 3 })).rejects.toMatchObject({
      reason: 'too_many_redirects',
    });
    await expect(safeFetch(`${base}/big`, { ...local, maxBytes: 50_000 })).rejects.toBeInstanceOf(
      FetchFailedError,
    );
    await expect(safeFetch(`${base}/pdf`, local)).rejects.toMatchObject({
      reason: 'unsupported_content',
    });
  });

  it('crawls allowed pages and skips pages disallowed by robots.txt', async () => {
    const crawler = new Crawler(new MemoryRobotsCache(), local);
    const ok = await crawler.crawl(`${base}/page`);
    expect(ok).toMatchObject({ ok: true, page: { title: 'Тест', h1: ['Здравей'] } });
    expect(await crawler.crawl(`${base}/secret`)).toMatchObject({ ok: false, reason: 'robots' });
    // A redirect into a disallowed path is stopped before that request.
    expect(await crawler.crawl(`${base}/to-secret`)).toMatchObject({ ok: false, reason: 'robots' });
    expect(await crawler.crawl(`${base}/missing`)).toMatchObject({
      ok: false,
      reason: 'http_error',
      status: 404,
    });
    // Without the test flag the same URL is blocked before any request.
    expect(await new Crawler().crawl(`${base}/page`)).toMatchObject({
      ok: false,
      reason: 'blocked',
    });
  });
});
