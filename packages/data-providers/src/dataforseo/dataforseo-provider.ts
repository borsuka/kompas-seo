import {
  normalizeKeyword,
  type Device,
  type IdeaOptions,
  type IdeaSource,
  type Intent,
  type KeywordIdea,
  type KeywordMetrics,
  type Locale,
  type MonthlyVolume,
  type SerpFeature,
  type SerpItem,
  type SerpItemType,
  type SerpSnapshot,
} from '@seo/shared';
import type { KeywordDataProvider, SerpProvider } from '../types.js';
import type { DataForSeoClient } from './client.js';

// ---------------------------------------------------------------- raw types

interface RawKeywordInfo {
  search_volume?: number | null;
  cpc?: number | null;
  competition?: number | null;
  competition_level?: string | null;
  monthly_searches?: { year: number; month: number; search_volume: number | null }[] | null;
}

/** Shape shared by Labs keyword_overview / keyword_suggestions / related_keywords.keyword_data. */
export interface RawLabsKeyword {
  keyword: string;
  keyword_info?: RawKeywordInfo | null;
  keyword_properties?: { keyword_difficulty?: number | null } | null;
  serp_info?: { serp_item_types?: string[] | null } | null;
  search_intent_info?: { main_intent?: string | null; foreign_intent?: string[] | null } | null;
}

interface RawLabsResult<T> {
  items?: T[] | null;
}

interface RawSerpItem {
  type: string;
  rank_group?: number;
  rank_absolute?: number;
  domain?: string | null;
  url?: string | null;
  title?: string | null;
  description?: string | null;
  items?: { title?: string | null; url?: string | null }[] | null;
  references?: { url?: string | null }[] | null;
}

interface RawSerpResult {
  keyword: string;
  datetime?: string;
  se_results_count?: number | null;
  item_types?: string[] | null;
  items?: RawSerpItem[] | null;
}

// ---------------------------------------------------------------- mapping

const INTENTS = new Set<Intent>(['informational', 'navigational', 'commercial', 'transactional']);

/** DataForSEO SERP element type → our feature list. */
const FEATURE_MAP: Record<string, SerpFeature> = {
  ai_overview: 'ai_overview',
  featured_snippet: 'featured_snippet',
  answer_box: 'featured_snippet',
  people_also_ask: 'people_also_ask',
  local_pack: 'local_pack',
  map: 'local_pack',
  shopping: 'shopping',
  popular_products: 'shopping',
  images: 'images',
  video: 'videos',
  short_videos: 'videos',
  top_stories: 'top_stories',
  knowledge_graph: 'knowledge_panel',
  related_searches: 'related_searches',
};

/** DataForSEO SERP element type → our item type (unlisted types are dropped). */
const ITEM_MAP: Record<string, SerpItemType> = {
  organic: 'organic',
  paid: 'paid',
  featured_snippet: 'featured_snippet',
  answer_box: 'featured_snippet',
  people_also_ask: 'people_also_ask',
  ai_overview: 'ai_overview',
  local_pack: 'local_pack',
  shopping: 'shopping',
  popular_products: 'shopping',
  images: 'images',
  video: 'video',
  top_stories: 'top_stories',
  knowledge_graph: 'knowledge_graph',
  related_searches: 'related_searches',
};

export function mapFeatures(types: readonly string[] | null | undefined): SerpFeature[] {
  const out = new Set<SerpFeature>();
  for (const t of types ?? []) {
    const f = FEATURE_MAP[t];
    if (f) out.add(f);
    if (t === 'paid') out.add('top_ads');
  }
  return [...out];
}

function mapTrend(monthly: RawKeywordInfo['monthly_searches']): MonthlyVolume[] {
  return (monthly ?? [])
    .filter((m) => m && typeof m.year === 'number' && typeof m.month === 'number')
    .map((m) => ({
      year: m.year,
      month: m.month,
      volume: Math.max(0, Math.round(m.search_volume ?? 0)),
    }))
    .sort((a, b) => a.year - b.year || a.month - b.month);
}

export function mapLabsKeyword(raw: RawLabsKeyword, loc: Locale, now: Date): KeywordMetrics {
  const info = raw.keyword_info ?? {};
  const level = info.competition_level?.toLowerCase();
  const intents = [
    raw.search_intent_info?.main_intent,
    ...(raw.search_intent_info?.foreign_intent ?? []),
  ].filter((i): i is Intent => !!i && INTENTS.has(i as Intent));
  const kd = raw.keyword_properties?.keyword_difficulty;
  return {
    keyword: normalizeKeyword(raw.keyword),
    locationCode: loc.locationCode,
    languageCode: loc.languageCode,
    volume: Math.max(0, Math.round(info.search_volume ?? 0)),
    cpc: info.cpc ?? null,
    competition: info.competition ?? null,
    competitionLevel: level === 'low' || level === 'medium' || level === 'high' ? level : null,
    trend: mapTrend(info.monthly_searches),
    kd: typeof kd === 'number' ? Math.min(100, Math.max(0, kd)) : null,
    intent: [...new Set(intents)],
    serpFeatures: mapFeatures(raw.serp_info?.serp_item_types),
    updatedAt: now.toISOString(),
  };
}

export function mapSerp(
  raw: RawSerpResult | undefined,
  keyword: string,
  loc: Locale,
  device: Device,
  depth: number,
  now: Date,
): SerpSnapshot {
  const items: SerpItem[] = [];
  const rawItems = raw?.items ?? [];
  const firstOrganic =
    rawItems.find((i) => i.type === 'organic')?.rank_absolute ?? Number.POSITIVE_INFINITY;
  const features = new Set(mapFeatures(raw?.item_types));
  features.delete('top_ads');

  for (const item of rawItems) {
    const type = ITEM_MAP[item.type];
    if (!type) continue;
    const rankAbsolute = Math.max(1, item.rank_absolute ?? items.length + 1);
    if (type === 'paid') features.add(rankAbsolute < firstOrganic ? 'top_ads' : 'bottom_ads');
    const extra: Record<string, unknown> = {};
    if (type === 'people_also_ask')
      extra.questions = (item.items ?? []).map((q) => q.title).filter(Boolean);
    if (type === 'related_searches')
      extra.queries = (item.items ?? []).map((q) => q.title).filter(Boolean);
    if (type === 'ai_overview')
      extra.references = (item.references ?? []).map((r) => r.url).filter(Boolean);
    items.push({
      rankAbsolute,
      rankGroup: Math.max(1, item.rank_group ?? 1),
      type,
      url: item.url ?? null,
      domain: item.domain?.replace(/^www\./, '') ?? null,
      title: item.title ?? null,
      description: item.description ?? null,
      ...(Object.keys(extra).length ? { extra } : {}),
    });
  }

  return {
    keyword: normalizeKeyword(raw?.keyword ?? keyword),
    locationCode: loc.locationCode,
    languageCode: loc.languageCode,
    device,
    depth,
    checkedAt: raw?.datetime
      ? new Date(raw.datetime.replace(' +00:00', 'Z').replace(' ', 'T')).toISOString()
      : now.toISOString(),
    totalResults: raw?.se_results_count ?? null,
    features: [...features],
    items,
  };
}

/** Question-style keywords (BG + EN), used to filter keyword suggestions server-side. */
const QUESTION_REGEX =
  '^(как|какво|какъв|каква|какви|защо|кога|къде|кой|коя|кое|колко|има ли|how|what|why|when|where|who|which|is|can|does)\\s';

const chunk = <T>(items: readonly T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, i * size + size),
  );

// ---------------------------------------------------------------- provider

/**
 * Keyword and SERP data from DataForSEO:
 * - metrics: DataForSEO Labs `keyword_overview` (≤ 700 keywords per request)
 * - ideas: Labs `keyword_suggestions` (matching, questions), `related_keywords`,
 *   SERP `autocomplete` + `keyword_overview` for its metrics
 * - SERP: `serp/google/organic/live/advanced`
 */
export class DataForSeoProvider implements KeywordDataProvider, SerpProvider {
  readonly name = 'dataforseo';

  constructor(
    private readonly client: DataForSeoClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getKeywordMetrics(keywords: string[], loc: Locale): Promise<KeywordMetrics[]> {
    const unique = [...new Set(keywords.map(normalizeKeyword).filter(Boolean))];
    const out: KeywordMetrics[] = [];
    for (const batch of chunk(unique, 700)) {
      const [result] = await this.client.post<RawLabsResult<RawLabsKeyword>>(
        'dataforseo_labs/google/keyword_overview/live',
        {
          keywords: batch,
          location_code: loc.locationCode,
          language_code: loc.languageCode,
          include_serp_info: true,
        },
      );
      for (const item of result?.items ?? []) out.push(mapLabsKeyword(item, loc, this.now()));
    }
    return out;
  }

  async getKeywordIdeas(seed: string, loc: Locale, opts: IdeaOptions): Promise<KeywordIdea[]> {
    const keyword = normalizeKeyword(seed);
    const perSource = Math.max(10, Math.ceil(opts.limit / opts.sources.length));
    const common = {
      location_code: loc.locationCode,
      language_code: loc.languageCode,
      include_serp_info: true,
    };
    const now = this.now();

    const fetchers: Record<IdeaSource, () => Promise<KeywordMetrics[]>> = {
      matching: async () => {
        const [r] = await this.client.post<RawLabsResult<RawLabsKeyword>>(
          'dataforseo_labs/google/keyword_suggestions/live',
          { ...common, keyword, include_seed_keyword: true, limit: Math.min(1000, perSource) },
        );
        return (r?.items ?? []).map((i) => mapLabsKeyword(i, loc, now));
      },
      question: async () => {
        const [r] = await this.client.post<RawLabsResult<RawLabsKeyword>>(
          'dataforseo_labs/google/keyword_suggestions/live',
          {
            ...common,
            keyword,
            limit: Math.min(1000, perSource),
            filters: [['keyword', 'regex', QUESTION_REGEX]],
          },
        );
        return (r?.items ?? []).map((i) => mapLabsKeyword(i, loc, now));
      },
      related: async () => {
        const [r] = await this.client.post<RawLabsResult<{ keyword_data: RawLabsKeyword }>>(
          'dataforseo_labs/google/related_keywords/live',
          { ...common, keyword, depth: 2, limit: Math.min(1000, perSource) },
        );
        return (r?.items ?? []).map((i) => mapLabsKeyword(i.keyword_data, loc, now));
      },
      autocomplete: async () => {
        const [r] = await this.client.post<{ items?: { suggestion?: string | null }[] | null }>(
          'serp/google/autocomplete/live/advanced',
          { keyword, location_code: loc.locationCode, language_code: loc.languageCode },
        );
        const suggestions = (r?.items ?? [])
          .map((i) => i.suggestion)
          .filter((s): s is string => !!s);
        return suggestions.length
          ? this.getKeywordMetrics(suggestions.slice(0, perSource), loc)
          : [];
      },
    };

    const seen = new Set<string>();
    const ideas: KeywordIdea[] = [];
    for (const source of opts.sources) {
      for (const m of await fetchers[source]()) {
        if (seen.has(m.keyword)) continue;
        seen.add(m.keyword);
        ideas.push({ ...m, source });
      }
    }
    return ideas.slice(0, opts.limit);
  }

  async getSerp(
    keyword: string,
    loc: Locale,
    device: Device,
    depth: number,
  ): Promise<SerpSnapshot> {
    const [result] = await this.client.post<RawSerpResult>('serp/google/organic/live/advanced', {
      keyword: normalizeKeyword(keyword),
      location_code: loc.locationCode,
      language_code: loc.languageCode,
      device,
      depth: Math.min(200, Math.max(10, depth)),
    });
    return mapSerp(result, keyword, loc, device, depth, this.now());
  }
}
