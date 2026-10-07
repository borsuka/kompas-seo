import type { Intent, SerpFeature } from '@seo/shared';

/**
 * Rule-based search intent (BG + EN) with SERP signals. Ambiguous keywords are
 * flagged `needsLlm` and classified later by an LLM in batches.
 */

interface Rule {
  intent: Intent;
  /** Lowercase stems. `prefix` matches word starts (BG inflection: евтин → евтина, евтини). */
  terms: readonly string[];
  mode: 'word' | 'prefix' | 'phrase';
  weight: number;
}

const RULES: readonly Rule[] = [
  // Transactional
  {
    intent: 'transactional',
    mode: 'prefix',
    weight: 3,
    terms: [
      'купи',
      'купя',
      'купува',
      'поръча',
      'цена',
      'цени',
      'евтин',
      'промоци',
      'намалени',
      'отстъпк',
      'доставк',
      'наем',
      'резерв',
      'абонамент',
      'оферт',
      'buy',
      'price',
      'pricing',
      'cheap',
      'order',
      'deal',
      'discount',
      'coupon',
      'shop',
      'booking',
      'hire',
    ],
  },
  {
    intent: 'transactional',
    mode: 'phrase',
    weight: 3,
    terms: ['онлайн магазин', 'for sale', 'near me'],
  },
  // Commercial investigation
  {
    intent: 'commercial',
    mode: 'prefix',
    weight: 2,
    terms: [
      'най-добр',
      'топ',
      'отзив',
      'мнени',
      'сравнени',
      'ревю',
      'алтернатив',
      'агенци',
      'фирм',
      'услуг',
      'best',
      'top',
      'review',
      'compare',
      'comparison',
      'alternative',
      'agency',
      'compan',
      'service',
      'software',
      'tool',
    ],
  },
  { intent: 'commercial', mode: 'word', weight: 2, terms: ['vs', 'versus', 'срещу'] },
  // Informational
  {
    intent: 'informational',
    mode: 'word',
    weight: 3,
    terms: [
      'как',
      'какво',
      'какъв',
      'каква',
      'какви',
      'защо',
      'кога',
      'къде',
      'кой',
      'коя',
      'кое',
      'колко',
      'how',
      'what',
      'why',
      'when',
      'where',
      'who',
      'which',
    ],
  },
  {
    intent: 'informational',
    mode: 'prefix',
    weight: 2,
    terms: [
      'наръчник',
      'ръководств',
      'съвет',
      'пример',
      'значени',
      'определени',
      'guide',
      'tutorial',
      'tips',
      'example',
      'meaning',
      'definition',
      'idea',
    ],
  },
  {
    intent: 'informational',
    mode: 'phrase',
    weight: 3,
    terms: ['какво е', 'what is', 'how to', 'има ли'],
  },
  // Navigational
  {
    intent: 'navigational',
    mode: 'prefix',
    weight: 3,
    terms: [
      'вход',
      'login',
      'log in',
      'sign in',
      'официален сайт',
      'official site',
      'контакти',
      'телефон',
    ],
  },
];

const SERP_SIGNALS: Partial<Record<SerpFeature, { intent: Intent; weight: number }>> = {
  shopping: { intent: 'transactional', weight: 2 },
  local_pack: { intent: 'commercial', weight: 1 },
  top_ads: { intent: 'commercial', weight: 1 },
  people_also_ask: { intent: 'informational', weight: 1 },
  featured_snippet: { intent: 'informational', weight: 1 },
  ai_overview: { intent: 'informational', weight: 1 },
  knowledge_panel: { intent: 'navigational', weight: 1 },
  sitelinks: { intent: 'navigational', weight: 2 },
};

export interface IntentResult {
  intents: Intent[];
  scores: Record<Intent, number>;
  /** 0–1: how clearly the strongest intent wins. */
  confidence: number;
  /** No rule matched: should be classified by the LLM. */
  needsLlm: boolean;
}

function tokenize(keyword: string): string[] {
  return keyword
    .toLowerCase()
    .split(/[\s,.;:!?"'()«»„“/\\|]+/u)
    .filter(Boolean);
}

/** Looks like a domain or brand+TLD → navigational. */
const DOMAIN_TOKEN = /^[\p{L}\d-]+\.(bg|com|net|org|eu|io|co|uk|de)$/u;

export function classifyIntent(
  keyword: string,
  serpFeatures: readonly SerpFeature[] = [],
): IntentResult {
  const text = keyword.toLowerCase().trim();
  const tokens = tokenize(text);
  const scores: Record<Intent, number> = {
    informational: 0,
    navigational: 0,
    commercial: 0,
    transactional: 0,
  };
  let ruleHits = 0;

  for (const rule of RULES) {
    for (const term of rule.terms) {
      const hit =
        rule.mode === 'phrase' || term.includes(' ')
          ? ` ${text} `.includes(` ${term} `) || text.startsWith(`${term} `) || text === term
          : rule.mode === 'word'
            ? tokens.includes(term)
            : tokens.some((t) => t.startsWith(term));
      if (hit) {
        scores[rule.intent] += rule.weight;
        ruleHits++;
        break;
      }
    }
  }
  // Check whitespace tokens: the punctuation tokenizer above splits "emag.bg" apart.
  if (text.split(/\s+/).some((t) => DOMAIN_TOKEN.test(t))) {
    scores.navigational += 3;
    ruleHits++;
  }

  for (const f of serpFeatures) {
    const signal = SERP_SIGNALS[f];
    if (signal) scores[signal.intent] += signal.weight;
  }

  const max = Math.max(...Object.values(scores));
  if (max === 0) {
    return { intents: ['informational'], scores, confidence: 0, needsLlm: true };
  }
  const intents = (Object.keys(scores) as Intent[])
    .filter((i) => scores[i] >= max * 0.6)
    .sort((x, y) => scores[y] - scores[x]);
  const total = Object.values(scores).reduce((s, v) => s + v, 0);
  const confidence = Number((max / total).toFixed(2));
  return { intents, scores, confidence, needsLlm: ruleHits === 0 };
}
