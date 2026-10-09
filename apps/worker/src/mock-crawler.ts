import { createHash } from 'node:crypto';
import { extractPage, type CrawlResult } from '@seo/crawler';
import type { CrawlHint } from './runtime.js';

/**
 * Local development only (SERP_PROVIDER=mock): the mock SERP links to fictional sites, so
 * instead of fetching them we synthesize deterministic pages about the keyword. Real
 * providers always use the real, robots.txt-respecting crawler.
 */

const SECTIONS = {
  bg: [
    'Какво е {k}',
    'Цени на {k}',
    'Как протича',
    'Предимства и недостатъци',
    'Видове и методи',
    'Как да изберем',
    'Съвети от специалист',
    'Често задавани въпроси',
    'Резултати и гаранция',
    'Отзиви от клиенти',
  ],
  en: [
    'What is {k}',
    '{k} prices',
    'How it works',
    'Pros and cons',
    'Types and methods',
    'How to choose',
    'Expert tips',
    'Frequently asked questions',
    'Results and guarantee',
    'Customer reviews',
  ],
};
const TERMS = {
  bg: [
    'цена',
    'качество',
    'гаранция',
    'консултация',
    'опит',
    'резултат',
    'материали',
    'срок',
    'поддръжка',
    'препоръки',
    'безплатен оглед',
    'професионален екип',
  ],
  en: [
    'price',
    'quality',
    'guarantee',
    'consultation',
    'experience',
    'result',
    'materials',
    'timeline',
    'support',
    'recommendations',
    'free quote',
    'professional team',
  ],
};

function rng(seed: string) {
  let h = createHash('sha256').update(seed).digest().readUInt32LE(0) || 1;
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 10_000) / 10_000;
  };
}

export class MockCrawler {
  async crawl(url: string, hint?: CrawlHint): Promise<CrawlResult> {
    const keyword = hint?.keyword ?? new URL(url).pathname.replace(/[/-]+/g, ' ').trim();
    const language = hint?.language ?? 'en';
    const lang = language === 'bg' ? 'bg' : 'en';
    const r = rng(`${url}|${keyword}`);
    const k = keyword.charAt(0).toLocaleUpperCase() + keyword.slice(1);
    const sections = [...SECTIONS[lang]]
      .sort(() => r() - 0.5)
      .slice(0, 4 + Math.floor(r() * 5))
      .map((s) => s.replace('{k}', keyword));
    const terms = TERMS[lang];
    const paragraph = () =>
      Array.from({ length: 3 + Math.floor(r() * 4) }, () => {
        const t1 = terms[Math.floor(r() * terms.length)]!;
        const t2 = terms[Math.floor(r() * terms.length)]!;
        return lang === 'bg'
          ? `${k} изисква внимание към ${t1} и ${t2}, затова разчитайте на доказан опит.`
          : `${k} needs attention to ${t1} and ${t2}, so rely on proven experience.`;
      }).join(' ');
    const html = `<!doctype html><html lang="${lang}"><head><title>${k} | ${new URL(url).hostname}</title>
      <meta name="description" content="${k}: ${terms.slice(0, 3).join(', ')}.">
      <script type="application/ld+json">{"@type":"${r() > 0.5 ? 'FAQPage' : 'Article'}"}</script></head>
      <body><main><h1>${k}</h1><p>${paragraph()}</p>
      ${sections.map((s) => `<h2>${s}</h2><p>${paragraph()}</p><p>${paragraph()}</p>`).join('')}
      ${Array.from({ length: Math.floor(r() * 6) }, (_, i) => `<img src="/i${i}.jpg" alt="${keyword}">`).join('')}
      </main></body></html>`;
    return { ok: true, page: extractPage(html, url), status: 200, finalUrl: url };
  }
}
