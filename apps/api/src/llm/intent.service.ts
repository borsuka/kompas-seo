import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { classifyIntent } from '@seo/seo-core';
import type { Intent, KeywordMetrics } from '@seo/shared';
import { REDIS } from '../infra/tokens.js';
import { LLM_PROVIDER, type LLMProvider } from '@seo/llm';

const CACHE_TTL_SEC = 30 * 86_400;
const BATCH = 100;
const cacheKey = (lang: string, keyword: string) => `intent:v1:${lang}:${keyword}`;

/**
 * Search intent pipeline:
 * 1. provider intent (e.g. DataForSEO Labs) when present;
 * 2. BG/EN rules + SERP signals (seo-core);
 * 3. LLM for keywords the rules can't decide, in batches of ≤ 100, cached in Redis.
 */
@Injectable()
export class IntentService {
  private readonly logger = new Logger('IntentService');

  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Returns the same metrics with `intent` filled for every keyword. */
  async ensureIntents(rows: KeywordMetrics[], language: string): Promise<KeywordMetrics[]> {
    const ambiguous: string[] = [];
    const result = rows.map((row) => {
      if (row.intent.length) return row;
      const rule = classifyIntent(row.keyword, row.serpFeatures);
      if (rule.needsLlm) ambiguous.push(row.keyword);
      return { ...row, intent: rule.intents };
    });
    if (!ambiguous.length || !this.llm.enabled) return result;

    const llmIntents = await this.classifyWithLlm([...new Set(ambiguous)], language);
    return result.map((row) => {
      const intents = llmIntents.get(row.keyword);
      return intents?.length ? { ...row, intent: intents } : row;
    });
  }

  private async classifyWithLlm(
    keywords: string[],
    language: string,
  ): Promise<Map<string, Intent[]>> {
    const out = new Map<string, Intent[]>();
    const cached = await this.redis
      .mget(keywords.map((k) => cacheKey(language, k)))
      .catch(() => []);
    const missing: string[] = [];
    keywords.forEach((k, i) => {
      const hit = cached[i];
      if (hit) out.set(k, JSON.parse(hit) as Intent[]);
      else missing.push(k);
    });

    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      try {
        const res = await this.llm.classifyIntents(batch, language);
        const pipeline = this.redis.pipeline();
        for (const [k, intents] of res) {
          out.set(k, intents);
          pipeline.set(cacheKey(language, k), JSON.stringify(intents), 'EX', CACHE_TTL_SEC);
        }
        await pipeline.exec();
      } catch (err) {
        // Rules already produced a best guess; an LLM outage must not fail the request.
        this.logger.warn({ err, batch: batch.length }, 'LLM intent classification failed');
      }
    }
    return out;
  }
}
