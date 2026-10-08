import { parse, type HTMLElement } from 'node-html-parser';

export interface ExtractedPage {
  url: string;
  lang: string | null;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  /** `noindex` in a robots meta tag. */
  noindex: boolean;
  h1: string[];
  headings: { level: 2 | 3; text: string }[];
  /** Visible main text (scripts, navigation, header/footer removed). */
  text: string;
  wordCount: number;
  links: { internal: number; external: number };
  images: { total: number; withoutAlt: number };
  /** schema.org @type values from JSON-LD. */
  schemaTypes: string[];
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const REMOVE = 'script, style, noscript, template, svg, iframe, nav, header, footer, aside, form';

export function countWords(text: string): number {
  // Letters in any script (Cyrillic, Latin, Greek…) and digits form words.
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
}

function schemaTypes(root: HTMLElement): string[] {
  const types = new Set<string>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    const t = obj['@type'];
    if (typeof t === 'string') types.add(t);
    else if (Array.isArray(t)) t.filter((x) => typeof x === 'string').forEach((x) => types.add(x));
    if (obj['@graph']) visit(obj['@graph']);
  };
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      visit(JSON.parse(s.textContent));
    } catch {
      // ignore invalid JSON-LD
    }
  }
  return [...types].sort();
}

/** Extracts SEO-relevant content from an HTML document. */
export function extractPage(html: string, pageUrl: string): ExtractedPage {
  const root = parse(html, { comment: false, blockTextElements: { script: true, style: true } });
  const base = new URL(pageUrl);
  const meta = (name: string) =>
    root.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? null;

  let internal = 0;
  let external = 0;
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    if (/^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
    try {
      const u = new URL(href, base);
      if (u.hostname.replace(/^www\./, '') === base.hostname.replace(/^www\./, '')) internal++;
      else external++;
    } catch {
      // ignore malformed links
    }
  }
  const imgs = root.querySelectorAll('img');
  const types = schemaTypes(root);

  const body =
    root.querySelector('main') ??
    root.querySelector('article') ??
    root.querySelector('body') ??
    root;
  const content = parse(body.toString());
  for (const el of content.querySelectorAll(REMOVE)) el.remove();
  // Keep block boundaries so words do not run together.
  const text = clean(content.structuredText ?? content.textContent);

  const canonicalHref = root.querySelector('link[rel="canonical"]')?.getAttribute('href');
  let canonical: string | null = null;
  if (canonicalHref) {
    try {
      canonical = new URL(canonicalHref, base).toString();
    } catch {
      canonical = null;
    }
  }

  return {
    url: pageUrl,
    lang: root.querySelector('html')?.getAttribute('lang') ?? null,
    title: clean(root.querySelector('title')?.textContent ?? '') || null,
    metaDescription: meta('description') ? clean(meta('description')!) : null,
    canonical,
    noindex: /noindex/i.test(meta('robots') ?? ''),
    h1: root
      .querySelectorAll('h1')
      .map((h) => clean(h.textContent))
      .filter(Boolean),
    headings: content
      .querySelectorAll('h2, h3')
      .map((h) => ({ level: (h.tagName === 'H2' ? 2 : 3) as 2 | 3, text: clean(h.textContent) }))
      .filter((h) => h.text),
    text,
    wordCount: countWords(text),
    links: { internal, external },
    images: {
      total: imgs.length,
      withoutAlt: imgs.filter((i) => !clean(i.getAttribute('alt') ?? '')).length,
    },
    schemaTypes: types,
  };
}
