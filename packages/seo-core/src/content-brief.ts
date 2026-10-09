/**
 * Deterministic content brief built only from the top-10 analysis. Used when no LLM is
 * configured (or it declines), so every brief has a usable structure.
 */
import type { ContentAnalysis } from './content-analysis.js';

export interface TemplateBrief {
  titleOptions: string[];
  metaDescription: string;
  h1: string;
  searchIntent: string;
  wordCount: { min: number; max: number };
  outline: { heading: string; level: 2 | 3; points: string[] }[];
  keyTerms: string[];
  questions: string[];
  notes: string[];
}

const COPY = {
  bg: {
    titles: (k: string, y: number) => [
      `${k}: пълно ръководство (${y})`,
      `${k} – всичко, което трябва да знаете`,
      `${k}: цени, съвети и примери`,
    ],
    meta: (k: string, terms: string) =>
      `Научете всичко за ${k}: ${terms}. Практични съвети и отговори на най-честите въпроси.`,
    intent: {
      informational: 'Информационно',
      commercial: 'Търговско',
      transactional: 'Транзакционно',
      navigational: 'Навигационно',
    },
    intro: 'Въведение',
    introPoints: (k: string) => [
      `Какво е ${k} и за кого е`,
      'Отговорете на основния въпрос в първите 2–3 изречения',
    ],
    faq: 'Често задавани въпроси',
    conclusion: 'Заключение',
    conclusionPoints: ['Обобщете основните изводи', 'Ясен призив за действие'],
    cover: (t: string) => `Покрийте „${t}“`,
    notes: (a: ContentAnalysis) =>
      [
        a.keywordInTitle >= 0.5
          ? 'Повечето страници от топ 10 съдържат ключовата дума в заглавието – направете същото.'
          : null,
        a.schemaTypes[0]
          ? `Най-честа структурирана разметка: ${a.schemaTypes
              .map((s) => s.type)
              .slice(0, 3)
              .join(', ')}.`
          : null,
        a.medianImages > 0
          ? `Медианата е ${a.medianImages} изображения на страница – добавете снимки с alt текст.`
          : null,
        `Целете ~${a.headings.medianH2} подзаглавия H2, както при страниците в топ 10.`,
      ].filter((x): x is string => !!x),
  },
  en: {
    titles: (k: string, y: number) => [
      `${k}: the complete guide (${y})`,
      `${k} – everything you need to know`,
      `${k}: prices, tips and examples`,
    ],
    meta: (k: string, terms: string) =>
      `Learn everything about ${k}: ${terms}. Practical tips and answers to the most common questions.`,
    intent: {
      informational: 'Informational',
      commercial: 'Commercial',
      transactional: 'Transactional',
      navigational: 'Navigational',
    },
    intro: 'Introduction',
    introPoints: (k: string) => [
      `What ${k} is and who it is for`,
      'Answer the main question in the first 2–3 sentences',
    ],
    faq: 'Frequently asked questions',
    conclusion: 'Conclusion',
    conclusionPoints: ['Sum up the key takeaways', 'Clear call to action'],
    cover: (t: string) => `Cover "${t}"`,
    notes: (a: ContentAnalysis) =>
      [
        a.keywordInTitle >= 0.5
          ? 'Most top-10 pages use the keyword in the title – do the same.'
          : null,
        a.schemaTypes[0]
          ? `Most common structured data: ${a.schemaTypes
              .map((s) => s.type)
              .slice(0, 3)
              .join(', ')}.`
          : null,
        a.medianImages > 0
          ? `The median is ${a.medianImages} images per page – add images with alt text.`
          : null,
        `Aim for ~${a.headings.medianH2} H2 sections, like the top-10 pages.`,
      ].filter((x): x is string => !!x),
  },
} as const;

const capitalize = (s: string) => (s ? s[0]!.toLocaleUpperCase() + s.slice(1) : s);

export function templateBrief(
  keyword: string,
  analysis: ContentAnalysis,
  opts: {
    language: string;
    intent?: keyof (typeof COPY)['en']['intent'];
    questions?: readonly string[];
    year?: number;
  },
): TemplateBrief {
  const c = opts.language === 'bg' ? COPY.bg : COPY.en;
  const k = capitalize(keyword);
  const terms = analysis.terms.map((t) => t.term);
  const singleTerms = terms.filter((t) => !t.includes(' '));
  const phrases = terms.filter((t) => t.includes(' '));
  const questions = [...new Set(opts.questions ?? [])].slice(0, 8);

  // Topics shared by the top pages become sections; terms that fit a topic become its points.
  const sections = analysis.topics.slice(0, 8).map((t) => ({
    heading: capitalize(t.heading),
    level: 2 as const,
    points: phrases
      .filter((p) => p.split(' ').some((w) => t.heading.includes(w)))
      .slice(0, 3)
      .map((p) => c.cover(p)),
  }));
  if (sections.length < 3) {
    for (const p of phrases.slice(0, 5 - sections.length))
      sections.push({ heading: capitalize(p), level: 2, points: [] });
  }

  return {
    titleOptions: c.titles(k, opts.year ?? new Date().getFullYear()),
    metaDescription: c
      .meta(keyword, (phrases.length ? phrases : singleTerms).slice(0, 3).join(', '))
      .slice(0, 160),
    h1: k,
    searchIntent: c.intent[opts.intent ?? 'informational'],
    wordCount: {
      min: analysis.wordCount.recommendedMin || 800,
      max: Math.max(analysis.wordCount.recommendedMax, analysis.wordCount.recommendedMin) || 1500,
    },
    outline: [
      { heading: c.intro, level: 2, points: c.introPoints(keyword) },
      ...sections,
      ...(questions.length
        ? [
            { heading: c.faq, level: 2 as const, points: [] },
            ...questions.map((q) => ({ heading: q, level: 3 as const, points: [] })),
          ]
        : []),
      { heading: c.conclusion, level: 2, points: [...c.conclusionPoints] },
    ],
    keyTerms: terms.slice(0, 25),
    questions,
    notes: c.notes(analysis),
  };
}
