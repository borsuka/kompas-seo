/**
 * Top-10 content analysis: what the pages that rank for a keyword have in common
 * (length, headings, terms, schema). Pure functions over already extracted pages.
 */

export interface AnalyzedPage {
  url: string;
  position: number;
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  headings: { level: 2 | 3; text: string }[];
  text: string;
  wordCount: number;
  images: number;
  schemaTypes: string[];
}

const STOPWORDS = new Set(
  // Bulgarian
  (
    'и в във на за с със от по до при се да е са съм си сме сте не ли че как какво какви кой коя кое кои ' +
    'това тази този тези там тук то той тя те ние вие аз ти но или ако като също още много може могат ' +
    'има няма бъде беше бяха след преди между над под без чрез към вече само така защо кога където ' +
    'един една едно едни всеки всички всичко нещо нашия нашата нашите вашия вашата ваши свой своя свои ' +
    'ще би бих сега тогава обаче освен както колко докато дори пък ни ги го му й им ме те ви ' +
    // English
    'the a an and or of to in on for with by from at as is are was were be been being it its this that ' +
    'these those you your we our they their he she his her not no but if then so than too very can could ' +
    'will would should may might must do does did have has had what which who whom how why when where all ' +
    'any each more most other some such only own same just also into over about after before up down out'
  ).split(/\s+/),
);

const tokenize = (text: string) =>
  (
    text
      .toLowerCase()
      .normalize('NFC')
      .match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) ?? []
  ).filter((w) => w.length >= 3 && !/^\d+$/.test(w));

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo));
}

/** Normalizes a heading for grouping ("1. Цени на импланти:" → "цени на импланти"). */
export function normalizeHeading(text: string) {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(/^[\s\d.)\-–—:]+/, '')
    .replace(/[?!.:;,"'«»„“”()]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ContentAnalysis {
  pagesAnalyzed: number;
  wordCount: {
    median: number;
    p25: number;
    p75: number;
    recommendedMin: number;
    recommendedMax: number;
  };
  headings: { medianH2: number; medianH3: number };
  /** Frequent H2/H3 topics (normalized), with the number of pages using them. */
  topics: { heading: string; pages: number }[];
  /** Terms (words and two-word phrases) used by many top pages. */
  terms: { term: string; pages: number; coverage: number; avgCount: number }[];
  keywordInTitle: number;
  keywordInH1: number;
  titleLength: number;
  metaDescriptionLength: number;
  medianImages: number;
  schemaTypes: { type: string; pages: number }[];
}

export function analyzeTopPages(
  pages: readonly AnalyzedPage[],
  keyword: string,
  opts: { maxTerms?: number; minCoverage?: number } = {},
): ContentAnalysis {
  const n = pages.length;
  const kw = keyword.toLowerCase().normalize('NFC');
  const words = pages.map((p) => p.wordCount).sort((a, b) => a - b);
  const p25 = quantile(words, 0.25);
  const p75 = quantile(words, 0.75);
  const median = quantile(words, 0.5);

  const kwTokens = new Set(tokenize(kw));
  const docFreq = new Map<string, { pages: number; total: number }>();
  for (const p of pages) {
    const tokens = tokenize(
      `${p.title ?? ''} ${p.h1.join(' ')} ${p.headings.map((h) => h.text).join(' ')} ${p.text}`,
    );
    const counts = new Map<string, number>();
    for (let i = 0; i < tokens.length; i++) {
      const w = tokens[i]!;
      if (!STOPWORDS.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
      const next = tokens[i + 1];
      if (next && !STOPWORDS.has(w) && !STOPWORDS.has(next)) {
        const bigram = `${w} ${next}`;
        counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
      }
    }
    for (const [term, c] of counts) {
      const d = docFreq.get(term) ?? { pages: 0, total: 0 };
      d.pages++;
      d.total += c;
      docFreq.set(term, d);
    }
  }
  const minPages = Math.max(2, Math.ceil(n * (opts.minCoverage ?? 0.3)));
  const terms = [...docFreq.entries()]
    // The keyword's own words are a given; recommend the surrounding vocabulary.
    .filter(([term, d]) => d.pages >= minPages && !(kwTokens.has(term) && !term.includes(' ')))
    .map(([term, d]) => ({
      term,
      pages: d.pages,
      coverage: Math.round((d.pages / Math.max(1, n)) * 100) / 100,
      avgCount: Math.round((d.total / d.pages) * 10) / 10,
    }))
    .sort((a, b) => b.pages - a.pages || b.avgCount - a.avgCount || a.term.localeCompare(b.term))
    .slice(0, opts.maxTerms ?? 40);

  const topicPages = new Map<string, { label: string; pages: Set<string> }>();
  for (const p of pages)
    for (const h of p.headings) {
      const key = normalizeHeading(h.text);
      if (key.length < 3 || key.split(' ').length > 12) continue;
      const t = topicPages.get(key) ?? { label: key, pages: new Set<string>() };
      t.pages.add(p.url);
      topicPages.set(key, t);
    }
  const topics = [...topicPages.values()]
    .filter((t) => t.pages.size >= 2)
    .map((t) => ({ heading: t.label, pages: t.pages.size }))
    .sort((a, b) => b.pages - a.pages || a.heading.localeCompare(b.heading))
    .slice(0, 30);

  const schema = new Map<string, number>();
  for (const p of pages)
    for (const t of new Set(p.schemaTypes)) schema.set(t, (schema.get(t) ?? 0) + 1);
  const median2 = (xs: number[]) =>
    quantile(
      [...xs].sort((a, b) => a - b),
      0.5,
    );
  const share = (f: (p: AnalyzedPage) => boolean) =>
    n ? Math.round((pages.filter(f).length / n) * 100) / 100 : 0;

  return {
    pagesAnalyzed: n,
    wordCount: {
      median,
      p25,
      p75,
      // Aim for the middle of the pack, not the longest outlier.
      recommendedMin: Math.round(p25 / 50) * 50,
      recommendedMax: Math.round(Math.max(p75, p25) / 50) * 50,
    },
    headings: {
      medianH2: median2(pages.map((p) => p.headings.filter((h) => h.level === 2).length)),
      medianH3: median2(pages.map((p) => p.headings.filter((h) => h.level === 3).length)),
    },
    topics,
    terms,
    keywordInTitle: share((p) => (p.title ?? '').toLowerCase().includes(kw)),
    keywordInH1: share((p) => p.h1.some((h) => h.toLowerCase().includes(kw))),
    titleLength: median2(pages.filter((p) => p.title).map((p) => p.title!.length)),
    metaDescriptionLength: median2(
      pages.filter((p) => p.metaDescription).map((p) => p.metaDescription!.length),
    ),
    medianImages: median2(pages.map((p) => p.images)),
    schemaTypes: [...schema.entries()]
      .map(([type, count]) => ({ type, pages: count }))
      .sort((a, b) => b.pages - a.pages || a.type.localeCompare(b.type)),
  };
}
