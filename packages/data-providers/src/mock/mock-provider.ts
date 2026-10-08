import {
  normalizeDomain,
  normalizeKeyword,
  wordCount,
  type Backlink,
  type BacklinkQuery,
  type BacklinkSummary,
  type CompetitorCandidate,
  type Device,
  type DomainKeyword,
  type DomainKeywordQuery,
  type DomainOverview,
  type IdeaOptions,
  type IdeaSource,
  type Intent,
  type KeywordIdea,
  type KeywordMetrics,
  type LinkRel,
  type Locale,
  type MonthlyVolume,
  type Paging,
  type ReferringDomain,
  type SerpFeature,
  type SerpItem,
  type SerpSnapshot,
} from '@seo/shared';
import type {
  BacklinkProvider,
  DomainDataProvider,
  KeywordDataProvider,
  SerpProvider,
} from '../types.js';
import { createRng, hashString, slugify, toVolumeBucket, type Rng } from './rng.js';
import {
  DOMAIN_SUFFIXES,
  LINK_SOURCE_STEMS,
  TLDS_BG,
  TLDS_EN,
  UNIVERSAL_DOMAINS,
  VOCAB_BG,
  VOCAB_EN,
  type Vocabulary,
} from './vocab.js';

export interface MockProviderOptions {
  /** Clock used for trends and dates. Data values do not depend on it. */
  now?: () => Date;
}

/** Relative market size per location (US = 1). Drives realistic volumes for small markets like BG. */
const MARKET_SIZE: Record<number, number> = {
  2840: 1,
  2826: 0.3,
  2276: 0.35,
  2250: 0.3,
  2380: 0.25,
  2724: 0.25,
  2616: 0.15,
  2528: 0.08,
  2642: 0.08,
  2100: 0.06,
};

const INTENT_RULES: { intent: Intent; re: RegExp }[] = [
  {
    intent: 'transactional',
    re: /(^|\s)(купи|купя|цена|цени|евтин\S*|поръчай|поръчка|оферта|пакети|buy|price|cost|cheap|order|deal|coupon)(\s|$)/u,
  },
  {
    intent: 'commercial',
    re: /(^|\s)(най-добр\S*|отзиви|сравнение|топ|vs|агенция|фирма|услуги|best|top|reviews?|agency|company|services|software|tools|инструменти)(\s|$)/u,
  },
  {
    intent: 'informational',
    re: /(^|\s)(какво|как|защо|кога|има ли|наръчник|съвети|примери|what|how|why|when|is|guide|tips|examples|checklist)(\s|$)/u,
  },
  { intent: 'navigational', re: /(\.com|\.bg|\.eu|вход|login|официален|official)/u },
];

const LOCAL_RE = /(софия|пловдив|варна|бургас|русе|наблизо|near me|london|berlin)/u;
const CTR_BY_POSITION = [0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];

function providerCtr(position: number): number {
  return CTR_BY_POSITION[position - 1] ?? Math.max(0.001, 0.018 * Math.exp(-(position - 10) / 15));
}

function vocabFor(loc: Locale, text = ''): Vocabulary {
  return loc.languageCode === 'bg' || /[Ѐ-ӿ]/.test(text) ? VOCAB_BG : VOCAB_EN;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function daysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

/** Fully offline provider: deterministic, realistic data seeded by the input. */
export class MockProvider
  implements KeywordDataProvider, SerpProvider, DomainDataProvider, BacklinkProvider
{
  readonly name = 'mock';
  private readonly now: () => Date;
  private readonly domainKeywordMemo = new Map<string, DomainKeyword[]>();
  private readonly backlinkMemo = new Map<string, Backlink[]>();

  constructor(opts: MockProviderOptions = {}) {
    this.now = opts.now ?? (() => new Date());
  }

  // ---------------------------------------------------------------- keywords

  async getKeywordMetrics(keywords: string[], loc: Locale): Promise<KeywordMetrics[]> {
    const unique = [...new Set(keywords.map(normalizeKeyword).filter(Boolean))];
    return unique.map((k) => this.metricsFor(k, loc));
  }

  async getKeywordIdeas(seed: string, loc: Locale, opts: IdeaOptions): Promise<KeywordIdea[]> {
    const k = normalizeKeyword(seed);
    const vocab = vocabFor(loc, k);
    const rng = createRng(`ideas|${loc.locationCode}|${loc.languageCode}|${k}`);
    const head = k.split(' ').slice(0, 2).join(' ');

    const bySource: Record<IdeaSource, string[]> = {
      matching: [
        k,
        ...vocab.suffixes.map((s) => `${k} ${s}`),
        ...vocab.prefixes.map((p) => `${p} ${k}`),
        ...rng
          .shuffle(vocab.suffixes)
          .slice(0, 12)
          .map((s, i) => `${k} ${s} ${vocab.suffixes[(i * 7 + 3) % vocab.suffixes.length]}`),
      ],
      related: vocab.related.flatMap((r) => [`${head} ${r}`, `${r} ${k.split(' ').at(-1)}`]),
      question: vocab.questions.map((q) => q.replace('{k}', k)),
      autocomplete: vocab.autocomplete.map(
        (letter, i) =>
          `${k} ${vocab.topics.find((t) => t.startsWith(letter)) ?? vocab.suffixes[i % vocab.suffixes.length]}`,
      ),
    };

    const seen = new Set<string>();
    const ideas: KeywordIdea[] = [];
    for (const source of opts.sources) {
      for (const raw of bySource[source]) {
        const kw = normalizeKeyword(raw);
        if (seen.has(kw) || wordCount(kw) > 10) continue;
        seen.add(kw);
        ideas.push({ ...this.metricsFor(kw, loc), source });
      }
    }
    ideas.sort((a, b) => (a.keyword === k ? -1 : b.keyword === k ? 1 : b.volume - a.volume));
    return ideas.slice(0, opts.limit);
  }

  private metricsFor(keyword: string, loc: Locale): KeywordMetrics {
    const rng = createRng(`kw|${loc.locationCode}|${loc.languageCode}|${keyword}`);
    const words = wordCount(keyword);
    const market = MARKET_SIZE[loc.locationCode] ?? 0.05;
    const intent = this.intentFor(keyword, rng);

    const isQuestion = intent.includes('informational') && words >= 3;
    const mu = Math.log(25_000 * market) - 1.1 * (words - 1) - (isQuestion ? 0.8 : 0);
    const base = Math.exp(mu + 1.2 * rng.normal());
    const trend = this.trendFor(keyword, loc, base, rng);
    const last12 = trend.slice(-12);
    const volume = toVolumeBucket(last12.reduce((s, m) => s + m.volume, 0) / last12.length);

    const commercialWeight = intent.includes('transactional')
      ? 1
      : intent.includes('commercial')
        ? 0.7
        : 0.2;
    const competition =
      volume === 0 ? null : Number(clamp(commercialWeight * rng.float(0.3, 1.1), 0, 1).toFixed(2));
    const cpc =
      volume === 0 ? null : Number((commercialWeight * rng.float(0.15, 3.5) + 0.03).toFixed(2));
    const kd = Math.round(clamp(8 + 11 * Math.log1p(volume / 30) + 10 * rng.normal(), 0, 100));

    return {
      keyword,
      locationCode: loc.locationCode,
      languageCode: loc.languageCode,
      volume,
      cpc,
      competition,
      competitionLevel:
        competition === null
          ? null
          : competition < 0.34
            ? 'low'
            : competition < 0.67
              ? 'medium'
              : 'high',
      trend,
      kd,
      intent,
      serpFeatures: this.featuresFor(keyword, intent, competition ?? 0, rng),
      updatedAt: this.now().toISOString(),
    };
  }

  private intentFor(keyword: string, rng: Rng): Intent[] {
    const matched = INTENT_RULES.filter((r) => r.re.test(keyword)).map((r) => r.intent);
    if (matched.length) return [...new Set(matched)];
    return [rng.bool(0.6) ? 'informational' : 'commercial'];
  }

  private featuresFor(
    keyword: string,
    intent: Intent[],
    competition: number,
    rng: Rng,
  ): SerpFeature[] {
    const f = new Set<SerpFeature>();
    const informational = intent.includes('informational');
    const buying = intent.includes('transactional') || intent.includes('commercial');
    if (rng.bool(informational ? 0.9 : 0.5)) f.add('people_also_ask');
    if (informational && rng.bool(0.45)) f.add('featured_snippet');
    if (informational && rng.bool(0.55)) f.add('ai_overview');
    if (buying && competition > 0.5 && rng.bool(0.8)) f.add('top_ads');
    if (buying && rng.bool(0.3)) f.add('bottom_ads');
    if (intent.includes('transactional') && rng.bool(0.6)) f.add('shopping');
    if (LOCAL_RE.test(keyword) && rng.bool(0.85)) f.add('local_pack');
    if (rng.bool(0.35)) f.add('images');
    if (/(^|\s)(как|how)(\s|$)/u.test(keyword) && rng.bool(0.6)) f.add('videos');
    if (rng.bool(0.15)) f.add('top_stories');
    if (rng.bool(0.1)) f.add('knowledge_panel');
    if (rng.bool(0.85)) f.add('related_searches');
    return [...f];
  }

  private trendFor(keyword: string, loc: Locale, base: number, rng: Rng): MonthlyVolume[] {
    const peak = rng.int(1, 12);
    const amplitude = rng.bool(0.4) ? rng.float(0.2, 0.6) : rng.float(0, 0.15);
    const growth = rng.float(-0.02, 0.03);
    const now = this.now();
    const out: MonthlyVolume[] = [];
    for (let i = 24; i >= 1; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const year = d.getUTCFullYear();
      const month = d.getUTCMonth() + 1;
      // Seeded per month so a given month always has the same value.
      const noise = createRng(`trend|${loc.locationCode}|${keyword}|${year}-${month}`).normal();
      const season = 1 + amplitude * Math.cos((2 * Math.PI * (month - peak)) / 12);
      const value = base * season * (1 + growth * (24 - i)) * (1 + 0.12 * noise);
      out.push({ year, month, volume: toVolumeBucket(Math.max(0, value)) });
    }
    return out;
  }

  // -------------------------------------------------------------------- SERP

  async getSerp(
    keyword: string,
    loc: Locale,
    device: Device,
    depth: number,
  ): Promise<SerpSnapshot> {
    const k = normalizeKeyword(keyword);
    const metrics = this.metricsFor(k, loc);
    const rng = createRng(`serp|${loc.locationCode}|${loc.languageCode}|${device}|${k}`);
    const topic = k.split(' ').slice(0, 2).join(' ');
    const pool = this.topicDomains(topic, loc, Math.max(depth, 30));

    // Keywords sharing a topic share most ranking URLs (realistic clustering input).
    const organic = pool.map((domain, i) => ({
      domain,
      url:
        createRng(`url|${domain}|${k}`).bool(0.25) || i % 7 === 6
          ? `https://${domain}/${slugify(k)}`
          : `https://${domain}/${slugify(topic)}`,
    }));
    for (let i = 0; i < organic.length - 1; i++) {
      if (rng.bool(device === 'mobile' ? 0.35 : 0.25)) {
        const j = Math.min(organic.length - 1, i + rng.int(1, 3));
        [organic[i], organic[j]] = [organic[j]!, organic[i]!];
      }
    }
    if (metrics.intent.includes('informational') && rng.bool(0.5)) {
      organic.splice(rng.int(0, 4), 0, {
        domain: 'wikipedia.org',
        url: `https://${loc.languageCode}.wikipedia.org/wiki/${encodeURIComponent(k.replace(/ /g, '_'))}`,
      });
    }
    if (rng.bool(0.4)) {
      organic.splice(rng.int(3, 9), 0, {
        domain: 'youtube.com',
        url: `https://www.youtube.com/watch?v=${hashString(k).toString(36)}`,
      });
    }
    organic.length = Math.min(organic.length, depth);

    const items: SerpItem[] = [];
    const push = (item: Omit<SerpItem, 'rankAbsolute'>) =>
      items.push({ ...item, rankAbsolute: items.length + 1 });
    const features = metrics.serpFeatures;
    const has = (f: SerpFeature) => features.includes(f);
    const vocab = vocabFor(loc, k);

    if (has('ai_overview')) {
      push({
        type: 'ai_overview',
        rankGroup: 1,
        url: null,
        domain: null,
        title: null,
        description: `${k}…`,
        extra: { references: organic.slice(0, 4).map((o) => o.url) },
      });
    }
    if (has('top_ads')) {
      const ads = rng.int(1, 4);
      for (let a = 0; a < ads; a++) {
        const domain = `${slugify(topic)}-${rng.pick(DOMAIN_SUFFIXES)}-ads${a}.${rng.pick(TLDS_BG)}`;
        push({
          type: 'paid',
          rankGroup: a + 1,
          url: `https://${domain}/`,
          domain,
          title: k,
          description: null,
        });
      }
    }
    if (has('featured_snippet') && organic[0]) {
      const src = organic[rng.int(0, Math.min(2, organic.length - 1))]!;
      push({
        type: 'featured_snippet',
        rankGroup: 1,
        url: src.url,
        domain: src.domain,
        title: k,
        description: null,
      });
    }

    organic.forEach((o, i) => {
      push({
        type: 'organic',
        rankGroup: i + 1,
        url: o.url,
        domain: o.domain,
        title: `${k.charAt(0).toUpperCase()}${k.slice(1)} | ${o.domain}`,
        description: null,
      });
      if (i === 1 && has('people_also_ask')) {
        push({
          type: 'people_also_ask',
          rankGroup: 1,
          url: null,
          domain: null,
          title: null,
          description: null,
          extra: {
            questions: rng
              .shuffle(vocab.questions)
              .slice(0, 4)
              .map((q) => q.replace('{k}', topic)),
          },
        });
      }
      if (i === 2 && has('local_pack')) {
        push({
          type: 'local_pack',
          rankGroup: 1,
          url: null,
          domain: null,
          title: null,
          description: null,
        });
      }
      if (i === 3 && has('shopping')) {
        push({
          type: 'shopping',
          rankGroup: 1,
          url: null,
          domain: null,
          title: null,
          description: null,
        });
      }
      if (i === 4 && has('videos')) {
        push({
          type: 'video',
          rankGroup: 1,
          url: null,
          domain: null,
          title: null,
          description: null,
        });
      }
    });
    if (has('related_searches')) {
      push({
        type: 'related_searches',
        rankGroup: 1,
        url: null,
        domain: null,
        title: null,
        description: null,
        extra: { queries: vocab.suffixes.slice(0, 6).map((s) => `${topic} ${s}`) },
      });
    }

    return {
      keyword: k,
      locationCode: loc.locationCode,
      languageCode: loc.languageCode,
      device,
      depth,
      checkedAt: this.now().toISOString(),
      totalResults: Math.round(Math.exp(rng.float(9, 17))),
      features,
      items,
    };
  }

  /** Stable list of fictional domains that rank for a topic. */
  private topicDomains(topic: string, loc: Locale, count: number): string[] {
    const rng = createRng(`topic|${loc.locationCode}|${topic}`);
    const tlds = loc.languageCode === 'bg' ? TLDS_BG : TLDS_EN;
    const words = topic.split(' ').map(slugify).filter(Boolean);
    const stems = [...words, ...rng.shuffle(LINK_SOURCE_STEMS).slice(0, 6)];
    const out = new Set<string>();
    let i = 0;
    while (out.size < count && i < count * 10) {
      const stem = stems[i % stems.length]!;
      const suffix = rng.pick(DOMAIN_SUFFIXES);
      const name = rng.bool(0.5) ? `${stem}-${suffix}` : `${suffix}${stem}`;
      out.add(`${name}${i >= stems.length * 2 ? i : ''}.${rng.pick(tlds)}`.replace(/-+/g, '-'));
      i++;
    }
    return [...out];
  }

  // ----------------------------------------------------------------- domains

  async getDomainKeywords(
    domain: string,
    loc: Locale,
    opts: DomainKeywordQuery,
  ): Promise<DomainKeyword[]> {
    const d = normalizeDomain(domain) ?? domain;
    const all =
      opts.mode === 'lost' ? this.lostDomainKeywords(d, loc) : this.allDomainKeywords(d, loc);
    const offset = opts.offset ?? 0;
    return all.slice(offset, offset + (opts.limit ?? 100));
  }

  /** Keywords the domain recently dropped out of the top 100 (≈ 8 % of its keywords). */
  private lostDomainKeywords(domain: string, loc: Locale): DomainKeyword[] {
    const current = new Set(this.allDomainKeywords(domain, loc).map((k) => k.keyword));
    const vocab = vocabFor(loc);
    const total = Math.max(3, Math.round(this.domainKeywordCount(domain, loc) * 0.08));
    const out: DomainKeyword[] = [];
    const seen = new Set<string>();
    for (let i = 0; out.length < total && i < total * 20; i++) {
      const r = createRng(`lost|${loc.locationCode}|${domain}|${i}`);
      const keyword = normalizeKeyword(`${r.pick(vocab.topics)} ${r.pick(vocab.suffixes)}`);
      if (current.has(keyword) || seen.has(keyword)) continue;
      seen.add(keyword);
      const m = this.metricsFor(keyword, loc);
      const last = r.int(5, 100);
      out.push({
        domain,
        keyword,
        locationCode: loc.locationCode,
        languageCode: loc.languageCode,
        // Last known position before the keyword was lost.
        position: last,
        previousPosition: last,
        url: `https://${domain}/${slugify(keyword.split(' ')[0] ?? keyword)}`,
        volume: m.volume,
        cpc: m.cpc,
        kd: m.kd,
        intent: m.intent,
        serpFeatures: m.serpFeatures,
        estTraffic: 0,
      });
    }
    return out.sort((a, b) => b.volume - a.volume || a.keyword.localeCompare(b.keyword));
  }

  async getDomainOverview(domain: string, loc: Locale): Promise<DomainOverview> {
    const d = normalizeDomain(domain) ?? domain;
    const rows = this.allDomainKeywords(d, loc);
    const total = this.domainKeywordCount(d, loc);
    const scale = total / Math.max(1, rows.length);
    const top = (n: number) => Math.round(rows.filter((r) => r.position <= n).length * scale);
    const estTraffic = Math.round(rows.reduce((s, r) => s + (r.estTraffic ?? 0), 0));
    const rng = createRng(`overview|${loc.locationCode}|${d}`);
    const growth = rng.float(-0.03, 0.06);
    const now = this.now();
    const history = Array.from({ length: 12 }, (_, idx) => {
      const back = 11 - idx;
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
      const noise = createRng(
        `overview-h|${loc.locationCode}|${d}|${date.getUTCFullYear()}-${date.getUTCMonth()}`,
      ).normal();
      const factor = Math.max(0.1, 1 - growth * back + 0.05 * noise);
      return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        keywords: Math.round(total * factor),
        estTraffic: Math.round(estTraffic * factor),
      };
    });
    // The home market dominates; a few other markets get a smaller share.
    const others = [2826, 2276, 2840, 2642].filter((c) => c !== loc.locationCode);
    const countries = [
      { locationCode: loc.locationCode, keywords: total, estTraffic },
      ...others.slice(0, rng.int(1, others.length)).map((code) => {
        const share = rng.float(0.02, 0.15);
        return {
          locationCode: code,
          keywords: Math.round(total * share),
          estTraffic: Math.round(estTraffic * share),
        };
      }),
    ];
    return {
      domain: d,
      locationCode: loc.locationCode,
      languageCode: loc.languageCode,
      organicKeywords: total,
      top3: top(3),
      top10: top(10),
      top100: total,
      estTraffic,
      newKeywords: Math.round(rows.filter((r) => r.previousPosition === null).length * scale),
      lostKeywords: this.lostDomainKeywords(d, loc).length,
      history,
      countries,
      updatedAt: now.toISOString(),
    };
  }

  domainKeywordCount(domain: string, loc: Locale): number {
    const rng = createRng(`dkcount|${loc.locationCode}|${domain}`);
    if (UNIVERSAL_DOMAINS.includes(domain)) return 5000;
    return Math.min(5000, 25 + Math.round(Math.exp(rng.float(2, 8.3))));
  }

  private allDomainKeywords(domain: string, loc: Locale): DomainKeyword[] {
    const memoKey = `${loc.locationCode}|${loc.languageCode}|${domain}`;
    const cached = this.domainKeywordMemo.get(memoKey);
    if (cached) return cached;

    const vocab = vocabFor(loc);
    const rng = createRng(`dk|${memoKey}`);
    const total = this.domainKeywordCount(domain, loc);
    // Each domain focuses on a few topics (rotated by domain hash) → partial overlap with peers.
    const focus = rng.int(3, 8);
    const offset = hashString(domain) % vocab.topics.length;
    const topics = Array.from(
      { length: vocab.topics.length },
      (_, i) => vocab.topics[(offset + i) % vocab.topics.length]!,
    );
    const brand = domain.split('.')[0]!.replace(/-/g, ' ');
    const modifiers = ['', ...vocab.suffixes];
    const prefixes = ['', ...vocab.prefixes];

    const rows: DomainKeyword[] = [];
    const seen = new Set<string>();
    for (let i = 0; rows.length < total && i < total * 3; i++) {
      const topicIdx = i < focus * 40 ? i % focus : i % topics.length;
      const topic = i === 0 ? brand : topics[topicIdx]!;
      const mod = modifiers[Math.floor(i / topics.length) % modifiers.length]!;
      const pre = prefixes[Math.floor(i / (topics.length * modifiers.length)) % prefixes.length]!;
      const keyword = normalizeKeyword(`${pre} ${topic} ${mod}`);
      if (!keyword || seen.has(keyword)) continue;
      seen.add(keyword);

      const r = createRng(`dkrow|${memoKey}|${keyword}`);
      const m = this.metricsFor(keyword, loc);
      const position = i === 0 ? 1 : clamp(Math.round(Math.exp(r.float(0, Math.log(100)))), 1, 100);
      rows.push({
        domain,
        keyword,
        locationCode: loc.locationCode,
        languageCode: loc.languageCode,
        position,
        previousPosition: r.bool(0.1) ? null : clamp(position + r.int(-6, 6), 1, 100),
        url: i === 0 ? `https://${domain}/` : `https://${domain}/${slugify(topic)}`,
        volume: m.volume,
        cpc: m.cpc,
        kd: m.kd,
        intent: m.intent,
        serpFeatures: m.serpFeatures,
        estTraffic: Number((m.volume * providerCtr(position)).toFixed(1)),
      });
    }
    rows.sort(
      (a, b) => (b.estTraffic ?? 0) - (a.estTraffic ?? 0) || a.keyword.localeCompare(b.keyword),
    );

    if (this.domainKeywordMemo.size > 50) this.domainKeywordMemo.clear();
    this.domainKeywordMemo.set(memoKey, rows);
    return rows;
  }

  async getCompetitors(domain: string, loc: Locale): Promise<CompetitorCandidate[]> {
    const d = normalizeDomain(domain) ?? domain;
    const rng = createRng(`comp|${loc.locationCode}|${d}`);
    const targetKeywords = this.domainKeywordCount(d, loc);
    const topTopics = [
      ...new Set(
        this.allDomainKeywords(d, loc)
          .slice(0, 50)
          .map((k) => k.keyword.split(' ')[0]!),
      ),
    ];
    const pool = this.topicDomains(topTopics.slice(0, 2).join(' ') || d, loc, 20).filter(
      (c) => c !== d,
    );
    const candidates = [...pool.slice(0, 15), ...UNIVERSAL_DOMAINS.slice(0, 3)];

    return candidates
      .map((c) => {
        const domainKeywords = this.domainKeywordCount(c, loc);
        const overlap = UNIVERSAL_DOMAINS.includes(c)
          ? rng.float(0.01, 0.05)
          : rng.float(0.05, 0.45);
        const commonKeywords = Math.max(
          1,
          Math.round(Math.min(domainKeywords, targetKeywords) * overlap),
        );
        return {
          domain: c,
          commonKeywords,
          domainKeywords,
          targetKeywords,
          avgPosition: Number(rng.float(4, 40).toFixed(1)),
          estTraffic: Math.round(domainKeywords * rng.float(2, 40)),
        };
      })
      .sort(
        (a, b) =>
          b.commonKeywords / (b.domainKeywords + b.targetKeywords - b.commonKeywords) -
          a.commonKeywords / (a.domainKeywords + a.targetKeywords - a.commonKeywords),
      );
  }

  // --------------------------------------------------------------- backlinks

  async getBacklinkSummary(target: string): Promise<BacklinkSummary> {
    const t = normalizeDomain(target) ?? target;
    const { referringDomains, backlinks, rating } = this.backlinkProfile(t);
    const rows = this.allBacklinks(t);
    return {
      target: t,
      backlinks,
      referringDomains,
      referringIps: Math.round(referringDomains * 0.85),
      rating,
      dofollow: Math.round(
        backlinks * (rows.filter((r) => r.rel === 'follow').length / Math.max(1, rows.length)),
      ),
      nofollow: Math.round(
        backlinks * (rows.filter((r) => r.rel !== 'follow').length / Math.max(1, rows.length)),
      ),
      brokenBacklinks: Math.round(
        backlinks * (rows.filter((r) => r.targetStatus === 404).length / Math.max(1, rows.length)),
      ),
      updatedAt: this.now().toISOString(),
    };
  }

  async getBacklinks(target: string, opts: BacklinkQuery): Promise<Backlink[]> {
    const t = normalizeDomain(target) ?? target;
    let rows = this.allBacklinks(t).filter((r) =>
      opts.status === 'all' ? true : opts.status === 'live' ? r.lostAt === null : r.lostAt !== null,
    );
    if (opts.rel) rows = rows.filter((r) => r.rel === opts.rel);
    if (opts.onePerDomain) {
      const seen = new Set<string>();
      rows = rows.filter((r) =>
        seen.has(r.sourceDomain) ? false : (seen.add(r.sourceDomain), true),
      );
    }
    return rows.slice(opts.offset, opts.offset + opts.limit);
  }

  async getReferringDomains(target: string, opts: Paging): Promise<ReferringDomain[]> {
    const t = normalizeDomain(target) ?? target;
    const byDomain = new Map<string, Backlink[]>();
    for (const row of this.allBacklinks(t)) {
      const list = byDomain.get(row.sourceDomain) ?? [];
      list.push(row);
      byDomain.set(row.sourceDomain, list);
    }
    const domains: ReferringDomain[] = [...byDomain.entries()].map(([domain, links]) => ({
      domain,
      backlinks: links.length,
      dofollow: links.filter((l) => l.rel === 'follow').length,
      rating: links[0]!.sourceRating,
      firstSeen: links.map((l) => l.firstSeen).sort()[0]!,
      lastSeen: links
        .map((l) => l.lastSeen)
        .sort()
        .at(-1)!,
      lostAt: links.every((l) => l.lostAt)
        ? links
            .map((l) => l.lostAt!)
            .sort()
            .at(-1)!
        : null,
    }));
    domains.sort((a, b) => b.rating - a.rating || a.domain.localeCompare(b.domain));
    return domains.slice(opts.offset, opts.offset + opts.limit);
  }

  private backlinkProfile(target: string) {
    const rng = createRng(`blprof|${target}`);
    const referringDomains = UNIVERSAL_DOMAINS.includes(target)
      ? 2_000_000
      : Math.round(Math.exp(rng.float(1.2, 7.5)));
    const backlinks = Math.round(referringDomains * rng.float(1.5, 9));
    const rating = Math.round(
      clamp(9 * Math.log1p(referringDomains) + 4 * rng.normal() - 5, 0, 100),
    );
    return { referringDomains, backlinks, rating };
  }

  /** Materialized sample (≤ 5000 rows) used for lists; summary counts are the full totals. */
  private allBacklinks(target: string): Backlink[] {
    const memo = this.backlinkMemo.get(target);
    if (memo) return memo;
    const { referringDomains, backlinks } = this.backlinkProfile(target);
    const sampleDomains = Math.min(referringDomains, 1000);
    const sampleRows = Math.min(backlinks, 5000);
    const now = this.now();
    const vocab =
      /[Ѐ-ӿ]/.test(target) || target.endsWith('.bg') || target.includes('xn--')
        ? VOCAB_BG
        : VOCAB_EN;
    const brand = target.split('.')[0]!.replace(/-/g, ' ');
    const rows: Backlink[] = [];

    const sourceDomain = (j: number) => {
      const r = createRng(`blsrc|${target}|${j}`);
      return `${r.pick(LINK_SOURCE_STEMS)}-${r.pick(LINK_SOURCE_STEMS)}${j}.${r.pick([...TLDS_BG, 'com'])}`;
    };
    const sourceRating = (j: number) =>
      Math.round(clamp(createRng(`blsr|${target}|${j}`).float(0, 1) ** 2 * 90 + 2, 0, 100));

    for (let i = 0; i < sampleRows; i++) {
      const r = createRng(`bl|${target}|${i}`);
      const j = i % Math.max(1, sampleDomains);
      const sd = sourceDomain(j);
      const anchorRoll = r.next();
      const topic = r.pick(vocab.topics);
      const firstDays = r.int(1, 1100);
      const lastDays = r.int(0, firstDays);
      const lost = r.bool(0.12);
      const relRoll = r.next();
      const rel: LinkRel =
        relRoll < 0.7
          ? 'follow'
          : relRoll < 0.9
            ? 'nofollow'
            : relRoll < 0.95
              ? 'ugc'
              : 'sponsored';
      const targetPath = r.bool(0.5) ? '' : slugify(topic);
      rows.push({
        sourceUrl: `https://${sd}/${slugify(topic)}-${i}`,
        sourceDomain: sd,
        targetUrl: `https://${target}/${targetPath}`,
        targetDomain: target,
        anchor:
          anchorRoll < 0.4
            ? brand
            : anchorRoll < 0.6
              ? `https://${target}`
              : anchorRoll < 0.8
                ? topic
                : r.pick(vocab.genericAnchors),
        rel,
        linkType: r.bool(0.85) ? 'text' : r.bool(0.7) ? 'image' : 'redirect',
        sourceRating: sourceRating(j),
        firstSeen: daysAgo(now, firstDays),
        lastSeen: daysAgo(now, lastDays),
        lostAt: lost ? daysAgo(now, lastDays) : null,
        targetStatus: targetPath && r.bool(0.04) ? 404 : 200,
      });
    }
    rows.sort((a, b) => b.sourceRating - a.sourceRating || a.sourceUrl.localeCompare(b.sourceUrl));
    if (this.backlinkMemo.size > 50) this.backlinkMemo.clear();
    this.backlinkMemo.set(target, rows);
    return rows;
  }
}
