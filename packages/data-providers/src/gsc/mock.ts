import { normalizeDomain, type Locale } from '@seo/shared';
import { MockProvider } from '../mock/mock-provider.js';
import { createRng } from '../mock/rng.js';
import type { GscClient, GscQuery, GscQueryRow, GscSite } from './google.js';

/** Mock access tokens carry the domain they "grant" (`mock:example.bg`). */
export const mockAccessToken = (domain: string) => `mock:${domain}`;

const CTR = [0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];
const ctrAt = (pos: number) =>
  pos <= 10 ? CTR[Math.max(0, Math.round(pos) - 1)]! : 0.01 * Math.exp(-(pos - 10) / 15);

function* days(from: string, to: string) {
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d <= new Date(`${to}T00:00:00Z`);
    d = new Date(d.getTime() + 86_400_000)
  )
    yield d.toISOString().slice(0, 10);
}

/**
 * Deterministic Search Console data derived from the mock provider's domain keywords:
 * daily impressions ≈ volume / 30 with noise, clicks from a CTR curve, and a few queries
 * split across two pages (so cannibalization detection has something to find).
 */
export class MockGscClient implements GscClient {
  readonly name = 'mock';

  constructor(
    private readonly mock = new MockProvider(),
    private readonly loc: Locale = { locationCode: 2100, languageCode: 'bg' },
  ) {}

  private domainOf(token: string) {
    if (!token.startsWith('mock:')) throw new Error('Invalid mock Search Console token');
    return normalizeDomain(token.slice(5)) ?? token.slice(5);
  }

  async listSites(accessToken: string): Promise<GscSite[]> {
    const d = this.domainOf(accessToken);
    return [
      { siteUrl: `sc-domain:${d}`, permissionLevel: 'siteOwner' },
      { siteUrl: `https://www.${d}/`, permissionLevel: 'siteFullUser' },
    ];
  }

  async query(accessToken: string, siteUrl: string, q: GscQuery): Promise<GscQueryRow[]> {
    const d = this.domainOf(accessToken);
    const keywords = await this.mock.getDomainKeywords(d, this.loc, {
      limit: 300,
      offset: 0,
      mode: 'live',
    });
    const rows: GscQueryRow[] = [];
    for (const day of days(q.startDate, q.endDate)) {
      for (const k of keywords) {
        const r = createRng(`gsc|${d}|${k.keyword}|${day}`);
        const impressions = Math.round(
          (k.volume / 30) * r.float(0.5, 1.5) * (k.position <= 20 ? 1 : 0.3),
        );
        if (impressions < 1) continue;
        const position = Math.max(1, k.position + r.float(-1.5, 1.5));
        const split = createRng(`gsc-split|${d}|${k.keyword}`).bool(0.08);
        const pages = split
          ? [
              { url: k.url, share: 0.55, position },
              { url: `${k.url.replace(/\/$/, '')}-2`, share: 0.45, position: position + 3 },
            ]
          : [{ url: k.url, share: 1, position }];
        for (const p of pages) {
          const imp = Math.max(1, Math.round(impressions * p.share));
          const clicks = Math.round(imp * ctrAt(p.position) * r.float(0.7, 1.3));
          const keys: Record<string, string> = {
            date: day,
            query: k.keyword,
            page: p.url,
            country: 'bgr',
            device: 'DESKTOP',
          };
          rows.push({
            keys: q.dimensions.map((dim) => keys[dim]!),
            clicks,
            impressions: imp,
            ctr: imp ? clicks / imp : 0,
            position: Math.round(p.position * 10) / 10,
          });
        }
      }
    }
    // Like the API: sorted by clicks (by date when grouped by date), paged with startRow.
    if (!q.dimensions.includes('date')) rows.sort((a, b) => b.clicks - a.clicks);
    const start = q.startRow ?? 0;
    return rows.slice(start, start + (q.rowLimit ?? 25_000));
  }
}
