/**
 * Backlink analysis: anchor classification, link gap, toxicity and disavow files.
 * Inputs are plain objects so the functions work with any provider's data.
 */

export interface LinkingDomain {
  domain: string;
  rating: number;
  backlinks: number;
  dofollow: number;
  /** Provider spam score 0–100, null when the provider has none. */
  spamScore: number | null;
  lostAt?: string | null;
}

// ---------------------------------------------------------------- anchors

export type AnchorType = 'branded' | 'url' | 'generic' | 'empty' | 'other';

/** Generic anchors in Bulgarian and English ("click here" style). */
const GENERIC_ANCHORS = new Set([
  'тук',
  'натиснете тук',
  'кликнете тук',
  'виж повече',
  'вижте повече',
  'прочети още',
  'прочетете още',
  'още',
  'линк',
  'сайт',
  'уебсайт',
  'източник',
  'here',
  'click here',
  'read more',
  'more',
  'learn more',
  'website',
  'link',
  'this',
  'source',
  'visit',
]);

const brandOf = (domain: string) => domain.replace(/^www\./, '').split('.')[0] ?? '';

export function classifyAnchor(anchor: string, targetDomain: string): AnchorType {
  const a = anchor.trim().toLowerCase().normalize('NFC');
  if (!a) return 'empty';
  if (/^(https?:\/\/|www\.)/.test(a) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/.test(a)) return 'url';
  const brand = brandOf(targetDomain);
  const compact = a.replace(/[\s_-]+/g, '');
  if (
    brand.length >= 3 &&
    (compact.includes(brand.replace(/[-_]/g, '')) || a.includes(brand.replace(/[-_]+/g, ' ')))
  )
    return 'branded';
  if (GENERIC_ANCHORS.has(a)) return 'generic';
  return 'other';
}

export interface AnchorRow {
  anchor: string;
  type: AnchorType;
  backlinks: number;
  referringDomains: number;
  dofollow: number;
}

/** Groups backlinks by anchor text (case-insensitive), most used first. */
export function anchorDistribution(
  links: readonly { anchor: string; sourceDomain: string; rel: string }[],
  targetDomain: string,
): AnchorRow[] {
  const groups = new Map<
    string,
    { anchor: string; backlinks: number; domains: Set<string>; dofollow: number }
  >();
  for (const l of links) {
    const key = l.anchor.trim().toLowerCase();
    const g = groups.get(key) ?? {
      anchor: l.anchor.trim(),
      backlinks: 0,
      domains: new Set(),
      dofollow: 0,
    };
    g.backlinks++;
    g.domains.add(l.sourceDomain);
    if (l.rel === 'follow') g.dofollow++;
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({
      anchor: g.anchor,
      type: classifyAnchor(g.anchor, targetDomain),
      backlinks: g.backlinks,
      referringDomains: g.domains.size,
      dofollow: g.dofollow,
    }))
    .sort(
      (a, b) =>
        b.referringDomains - a.referringDomains ||
        b.backlinks - a.backlinks ||
        a.anchor.localeCompare(b.anchor),
    );
}

// --------------------------------------------------------------- link gap

export interface LinkGapRow {
  domain: string;
  rating: number;
  spamScore: number | null;
  /** Backlinks from this domain to each compared domain (0 = no link). */
  links: Record<string, number>;
  /** How many competitors this domain links to. */
  competitors: number;
}

/**
 * Domains that link to at least `minCompetitors` competitors but not to the target —
 * the most promising outreach prospects. Lost links do not count.
 */
export function linkGap(
  target: string,
  competitors: readonly string[],
  referring: ReadonlyMap<string, readonly LinkingDomain[]>,
  opts: { minCompetitors?: number } = {},
): LinkGapRow[] {
  const live = (d: string) => (referring.get(d) ?? []).filter((r) => !r.lostAt);
  const own = new Set(live(target).map((r) => r.domain));
  const all = [target, ...competitors];
  const rows = new Map<string, LinkGapRow>();
  for (const c of competitors) {
    for (const r of live(c)) {
      if (own.has(r.domain) || all.includes(r.domain)) continue;
      const row =
        rows.get(r.domain) ??
        ({
          domain: r.domain,
          rating: r.rating,
          spamScore: r.spamScore,
          links: Object.fromEntries(all.map((d) => [d, 0])),
          competitors: 0,
        } satisfies LinkGapRow);
      row.links[c] = r.backlinks;
      row.rating = Math.max(row.rating, r.rating);
      rows.set(r.domain, row);
    }
  }
  const min = opts.minCompetitors ?? 1;
  return [...rows.values()]
    .map((r) => ({ ...r, competitors: competitors.filter((c) => (r.links[c] ?? 0) > 0).length }))
    .filter((r) => r.competitors >= min)
    .sort(
      (a, b) =>
        b.competitors - a.competitors || b.rating - a.rating || a.domain.localeCompare(b.domain),
    );
}

// --------------------------------------------------------------- toxicity

export type ToxicReason =
  | 'provider_spam_score'
  | 'spammy_tld'
  | 'spammy_words'
  | 'no_authority'
  | 'link_farm'
  | 'ip_address'
  | 'all_nofollow';

const SPAMMY_TLDS = new Set([
  'xyz',
  'top',
  'click',
  'icu',
  'buzz',
  'loan',
  'work',
  'gq',
  'tk',
  'ml',
  'cf',
  'ga',
  'rest',
  'cam',
]);
const SPAMMY_WORDS = [
  'casino',
  'kazino',
  'bet',
  'poker',
  'porn',
  'xxx',
  'viagra',
  'cialis',
  'pills',
  'loan',
  'kredit-bez',
  'free-links',
  'backlink',
  'seo-links',
  'link-directory',
  'linkfarm',
];

export interface Toxicity {
  /** 0–100; ≥ 60 is high risk. */
  score: number;
  level: 'low' | 'medium' | 'high';
  reasons: ToxicReason[];
}

/**
 * Heuristic toxicity of a referring domain. The provider spam score (when present) sets a
 * floor; our signals add up on top of it. Signals are deliberately conservative: a domain
 * is only "high" with strong evidence, because disavowing good links hurts rankings.
 */
export function toxicity(d: LinkingDomain): Toxicity {
  const reasons: ToxicReason[] = [];
  let signals = 0;
  const host = d.domain.toLowerCase();
  const tld = host.split('.').at(-1) ?? '';

  if (d.spamScore !== null && d.spamScore >= 50) reasons.push('provider_spam_score');
  if (SPAMMY_TLDS.has(tld)) {
    reasons.push('spammy_tld');
    signals += 25;
  }
  if (SPAMMY_WORDS.some((w) => host.includes(w))) {
    reasons.push('spammy_words');
    signals += 35;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    reasons.push('ip_address');
    signals += 30;
  }
  if (d.rating <= 3) {
    reasons.push('no_authority');
    signals += 15;
  }
  // Many links from one weak domain: sitewide footer links or a link farm.
  if (d.backlinks >= 200 && d.rating < 20) {
    reasons.push('link_farm');
    signals += 20;
  }
  if (d.backlinks > 0 && d.dofollow === 0 && reasons.length > 0) reasons.push('all_nofollow');

  const score = Math.round(
    Math.min(100, Math.max(d.spamScore ?? 0, signals + (d.spamScore ?? 0) * 0.5)),
  );
  return { score, level: score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low', reasons };
}

// ---------------------------------------------------------------- disavow

export interface DisavowEntry {
  type: 'domain' | 'url';
  value: string;
  reason?: string | null;
}

/**
 * Google disavow file: UTF-8 text, one `domain:example.com` or full URL per line,
 * `#` comments. Duplicates are removed and domains are listed first.
 */
export function disavowFile(entries: readonly DisavowEntry[], header?: string): string {
  const lines: string[] = [];
  if (header) for (const h of header.split('\n')) lines.push(`# ${h}`.trimEnd());
  // Normalize first so duplicates merge (keeping any reason) regardless of input order.
  const merged = new Map<
    string,
    { type: DisavowEntry['type']; line: string; reason: string | null }
  >();
  for (const e of entries) {
    const line =
      e.type === 'domain'
        ? `domain:${e.value
            .trim()
            .toLowerCase()
            .replace(/^www\./, '')}`
        : e.value.trim();
    if (!line || line === 'domain:') continue;
    const reason = e.reason?.replace(/\s+/g, ' ').trim() || null;
    const prev = merged.get(line);
    merged.set(line, { type: e.type, line, reason: prev?.reason ?? reason });
  }
  const sorted = [...merged.values()].sort((a, b) =>
    a.type === b.type ? a.line.localeCompare(b.line) : a.type === 'domain' ? -1 : 1,
  );
  for (const e of sorted) {
    if (e.reason) lines.push(`# ${e.reason}`);
    lines.push(e.line);
  }
  return `${lines.join('\n')}\n`;
}

// --------------------------------------------------------------- trends

/** New and lost referring domains per month (YYYY-MM), oldest first. */
export function referringDomainsByMonth(
  domains: readonly { firstSeen: string; lostAt: string | null }[],
  months: number,
  now: Date = new Date(),
): { month: string; new: number; lost: number }[] {
  const keys = Array.from({ length: months }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
  const out = new Map(keys.map((k) => [k, { month: k, new: 0, lost: 0 }]));
  for (const d of domains) {
    const added = out.get(d.firstSeen.slice(0, 7));
    if (added) added.new++;
    if (d.lostAt) {
      const row = out.get(d.lostAt.slice(0, 7));
      if (row) row.lost++;
    }
  }
  return [...out.values()];
}
