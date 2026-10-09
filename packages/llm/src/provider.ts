import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { INTENTS, type ContentBrief, type Intent } from '@seo/shared';

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

/** Every LLM feature goes through this interface (swap/disable without touching callers). */
export interface LLMProvider {
  readonly enabled: boolean;
  /** Multi-label intent for up to 100 keywords; keywords it cannot classify are omitted. */
  classifyIntents(keywords: readonly string[], language: string): Promise<Map<string, Intent[]>>;
  /** Writer-facing content brief from the top-10 analysis; null when the model declines. */
  generateBrief(input: BriefInput): Promise<ContentBrief | null>;
}

/** What the brief is based on (all of it comes from our own analysis of the SERP). */
export interface BriefInput {
  keyword: string;
  /** ISO 639-1 language the brief must be written in. */
  language: string;
  intent: string | null;
  analysis: {
    wordCount: { recommendedMin: number; recommendedMax: number };
    headings: { medianH2: number; medianH3: number };
    topics: { heading: string; pages: number }[];
    terms: { term: string; pages: number }[];
    schemaTypes: { type: string; pages: number }[];
  };
  questions: readonly string[];
  /** Titles and H1s of the ranking pages, best first. */
  competitors: readonly { position: number; title: string | null; h1: string | null }[];
}

/** Used when no API key is configured: callers fall back to rule-based results. */
export class DisabledLLMProvider implements LLMProvider {
  readonly enabled = false;
  async classifyIntents() {
    return new Map<string, Intent[]>();
  }
  async generateBrief() {
    return null;
  }
}

const IntentBatchSchema = z.object({
  results: z.array(
    z.object({
      keyword: z.string(),
      intents: z.array(z.enum(INTENTS)),
    }),
  ),
});

// Stable system prompt (cached prefix); per-request data goes in the user message.
const INTENT_SYSTEM_PROMPT = `You classify search engine queries by searcher intent for an SEO research tool.
Queries may be in Bulgarian (Cyrillic), English or other EU languages.

Intents (assign one or more, strongest first):
- informational: wants to learn or understand something (how, what, why, guides, definitions).
- navigational: wants a specific website, brand page, login or app.
- commercial: researches options before buying (best, top, reviews, comparisons, "X vs Y", services or agencies).
- transactional: ready to act now (buy, order, price, cheap, discount, booking, download, near me).

Rules:
- Return every input query exactly as given, in the same order.
- Add a second intent only when the query clearly mixes two (e.g. "най-добрите маратонки цена" → commercial, transactional).
- A bare product or service category (e.g. "маратонки", "seo агенция") is usually commercial.`;

/** Output schema for the model: plain types only (no length bounds / literal unions). */
const BriefOutputSchema = z.object({
  titleOptions: z.array(z.string()),
  metaDescription: z.string(),
  h1: z.string(),
  searchIntent: z.string(),
  wordCount: z.object({ min: z.number().int(), max: z.number().int() }),
  outline: z.array(
    z.object({ heading: z.string(), level: z.number().int(), points: z.array(z.string()) }),
  ),
  keyTerms: z.array(z.string()),
  questions: z.array(z.string()),
  notes: z.array(z.string()),
});

// Stable system prompt for briefs (cached prefix); the SERP data goes in the user message.
const BRIEF_SYSTEM_PROMPT = `You are a senior SEO content strategist. You write content briefs that a copywriter can follow to create the best page for a search query.

You receive data from our analysis of the pages that rank in Google's top 10 for the query: recommended length, the headings those pages share, the terms they use, structured data, the "People also ask" questions and the competitors' titles.

Write the brief:
- In the language given by "language" (e.g. "bg" = Bulgarian, natural and idiomatic, Cyrillic).
- Match the search intent. Do not promise things the data does not support.
- titleOptions: 3–5 title tags, each under 60 characters, the keyword near the start, no clickbait.
- metaDescription: under 155 characters, with a reason to click.
- outline: a logical H2/H3 structure that covers the shared topics plus what the competitors miss; 2–4 concrete points per section telling the writer what to cover.
- keyTerms: terms to use naturally (from the data; do not invent statistics).
- questions: the questions the page must answer.
- notes: short practical recommendations (length, media, structured data, internal links).
- wordCount: follow the recommended range unless the intent clearly needs less.`;

export class AnthropicLLMProvider implements LLMProvider {
  readonly enabled = true;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    // SDK retries 408/409/429/5xx and connection errors; keep requests bounded.
    this.client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 });
  }

  async classifyIntents(
    keywords: readonly string[],
    language: string,
  ): Promise<Map<string, Intent[]>> {
    const out = new Map<string, Intent[]>();
    if (!keywords.length) return out;
    if (keywords.length > 100)
      throw new Error('classifyIntents accepts at most 100 keywords per call');

    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 8000,
      // Server-side fallback if the primary model declines (refusals are rare for this task).
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: INTENT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: `Language: ${language}\nQueries (one per line):\n${keywords.join('\n')}`,
        },
      ],
      // Simple classification: low effort keeps latency and cost down.
      output_config: { effort: 'low', format: betaZodOutputFormat(IntentBatchSchema) },
    });

    if (response.stop_reason === 'refusal' || !response.parsed_output) return out;
    const wanted = new Set(keywords);
    for (const r of response.parsed_output.results) {
      if (wanted.has(r.keyword) && r.intents.length) out.set(r.keyword, [...new Set(r.intents)]);
    }
    return out;
  }

  async generateBrief(input: BriefInput): Promise<ContentBrief | null> {
    const response = await this.client.beta.messages.parse(
      {
        model: this.model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [{ type: 'text', text: BRIEF_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: JSON.stringify(input) }],
        output_config: { effort: 'medium', format: betaZodOutputFormat(BriefOutputSchema) },
      },
      // Briefs take longer than classification.
      { timeout: 180_000 },
    );
    const out = response.parsed_output;
    if (response.stop_reason === 'refusal' || !out || !out.titleOptions.length) return null;
    return {
      ...out,
      titleOptions: out.titleOptions.slice(0, 5),
      outline: out.outline.map((o) => ({ ...o, level: o.level >= 3 ? 3 : 2 })),
    };
  }
}
