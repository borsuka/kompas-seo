import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { INTENTS, type Intent } from '@seo/shared';

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

/** Every LLM feature goes through this interface (swap/disable without touching callers). */
export interface LLMProvider {
  readonly enabled: boolean;
  /** Multi-label intent for up to 100 keywords; keywords it cannot classify are omitted. */
  classifyIntents(keywords: readonly string[], language: string): Promise<Map<string, Intent[]>>;
}

/** Used when no API key is configured: callers fall back to rule-based results. */
export class DisabledLLMProvider implements LLMProvider {
  readonly enabled = false;
  async classifyIntents() {
    return new Map<string, Intent[]>();
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
}
