/**
 * robots.txt per RFC 9309 (as Google implements it): the most specific matching user-agent
 * group applies; within it the longest matching rule wins and Allow wins ties; `*` and `$`
 * wildcards are supported.
 */

export interface RobotsRules {
  /** Rules of the group that applies to our user agent. */
  rules: { allow: boolean; pattern: string }[];
  crawlDelaySec: number | null;
  sitemaps: string[];
}

interface Group {
  agents: string[];
  rules: { allow: boolean; pattern: string }[];
  crawlDelay: number | null;
}

export function parseRobots(text: string, userAgent: string): RobotsRules {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') {
      // An empty Disallow means "allow everything" and adds no rule.
      if (value) current.rules.push({ allow: key === 'allow', pattern: value });
    } else if (key === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }

  // Product token = user agent up to the first "/" (e.g. "kompasseobot").
  const token = userAgent.split('/')[0]!.trim().toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.startsWith(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return {
    rules: chosen.flatMap((g) => g.rules),
    crawlDelaySec: chosen.map((g) => g.crawlDelay).find((d) => d !== null) ?? null,
    sitemaps,
  };
}

function matchLength(pattern: string, path: string): number {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = new RegExp(
    `^${body
      .split('*')
      .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}${anchored ? '$' : ''}`,
  );
  return regex.test(path) ? body.length : -1;
}

/** Whether `pathWithQuery` (e.g. "/a/b?x=1") may be crawled. */
export function isAllowed(robots: RobotsRules, pathWithQuery: string): boolean {
  if (pathWithQuery === '/robots.txt') return true;
  let best = -1;
  let allowed = true;
  for (const r of robots.rules) {
    const len = matchLength(r.pattern, pathWithQuery);
    if (len < 0) continue;
    if (len > best || (len === best && r.allow)) {
      best = len;
      allowed = r.allow;
    }
  }
  return allowed;
}

export const ALLOW_ALL: RobotsRules = { rules: [], crawlDelaySec: null, sitemaps: [] };
export const DISALLOW_ALL: RobotsRules = {
  rules: [{ allow: false, pattern: '/' }],
  crawlDelaySec: null,
  sitemaps: [],
};
