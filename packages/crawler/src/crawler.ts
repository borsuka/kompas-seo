import { extractPage, type ExtractedPage } from './extract.js';
import { BlockedUrlError } from './network.js';
import { ALLOW_ALL, DISALLOW_ALL, isAllowed, parseRobots, type RobotsRules } from './robots.js';
import {
  CRAWLER_USER_AGENT,
  FetchFailedError,
  safeFetch,
  type SafeFetchOptions,
} from './safe-fetch.js';

/** Where parsed robots.txt files are cached (Redis in production, a Map in tests). */
export interface RobotsCache {
  get(origin: string): Promise<string | null>;
  set(origin: string, value: string, ttlSec: number): Promise<void>;
}

export class MemoryRobotsCache implements RobotsCache {
  private readonly data = new Map<string, string>();
  async get(origin: string) {
    return this.data.get(origin) ?? null;
  }
  async set(origin: string, value: string) {
    this.data.set(origin, value);
  }
}

const ROBOTS_TTL_SEC = 24 * 3600;

class RobotsDisallowedError extends Error {}

export type CrawlResult =
  | { ok: true; page: ExtractedPage; status: number; finalUrl: string }
  | {
      ok: false;
      url: string;
      reason: 'robots' | 'blocked' | 'http_error' | 'noindex' | FetchFailedError['reason'];
      status?: number;
    };

export class Crawler {
  constructor(
    private readonly cache: RobotsCache = new MemoryRobotsCache(),
    private readonly fetchOptions: SafeFetchOptions = {},
  ) {}

  /**
   * robots.txt for an origin (RFC 9309): 4xx = no restrictions, 5xx or unreachable = full
   * disallow (we must not crawl a site whose rules we cannot read).
   */
  async robots(origin: string): Promise<RobotsRules> {
    const ua = this.fetchOptions.userAgent ?? CRAWLER_USER_AGENT;
    const cached = await this.cache.get(origin);
    if (cached !== null) return cached === '\u0000deny' ? DISALLOW_ALL : parseRobots(cached, ua);
    let stored: string;
    try {
      const res = await safeFetch(`${origin}/robots.txt`, {
        ...this.fetchOptions,
        accept: [],
        maxBytes: 500 * 1024,
      });
      stored = res.status >= 500 ? '\u0000deny' : res.status >= 400 ? '' : res.body;
    } catch (err) {
      if (err instanceof BlockedUrlError) throw err;
      stored = '\u0000deny';
    }
    await this.cache.set(origin, stored, ROBOTS_TTL_SEC);
    return stored === '\u0000deny' ? DISALLOW_ALL : stored ? parseRobots(stored, ua) : ALLOW_ALL;
  }

  /** Fetches and extracts one page, respecting robots.txt of its origin. */
  async crawl(url: string): Promise<CrawlResult> {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return { ok: false, url, reason: 'blocked' };
    }
    try {
      // robots.txt is checked before every hop, so a redirect cannot lead into a
      // disallowed path (of the same or another origin).
      const res = await safeFetch(target.toString(), {
        ...this.fetchOptions,
        beforeRequest: async (hop) => {
          if (hop.pathname === '/robots.txt') return;
          const rules = await this.robots(hop.origin);
          if (!isAllowed(rules, `${hop.pathname}${hop.search}`)) throw new RobotsDisallowedError();
        },
      });
      if (res.status >= 400) return { ok: false, url, reason: 'http_error', status: res.status };
      const page = extractPage(res.body, res.url);
      return { ok: true, page, status: res.status, finalUrl: res.url };
    } catch (err) {
      if (err instanceof RobotsDisallowedError) return { ok: false, url, reason: 'robots' };
      if (err instanceof BlockedUrlError) return { ok: false, url, reason: 'blocked' };
      if (err instanceof FetchFailedError) return { ok: false, url, reason: err.reason };
      return { ok: false, url, reason: 'network' };
    }
  }
}
