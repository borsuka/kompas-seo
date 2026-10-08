import { describe, expect, it, vi } from 'vitest';
import { backlinkSchema, backlinkSummarySchema, referringDomainSchema } from '@seo/shared';
import { DataForSeoClient } from './client.js';
import { DataForSeoBacklinkProvider, parseDfsDate } from './dataforseo-backlinks.js';

const now = () => new Date('2026-10-08T00:00:00Z');

function fakeFetch(handler: (path: string, body: Record<string, unknown>) => unknown) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.split('/v3/')[1]!;
    const body = (JSON.parse(String(init.body)) as Record<string, unknown>[])[0]!;
    calls.push({ path, body });
    return new Response(
      JSON.stringify({
        status_code: 20000,
        status_message: 'Ok.',
        cost: 0.02,
        tasks: [
          {
            id: 't',
            status_code: 20000,
            status_message: 'Ok.',
            cost: 0.02,
            result: [handler(path, body)],
          },
        ],
      }),
      { status: 200 },
    );
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const provider = (fn: typeof fetch) =>
  new DataForSeoBacklinkProvider(
    new DataForSeoClient({ login: 'l', password: 'p', fetch: fn }),
    now,
  );

describe('DataForSeoBacklinkProvider', () => {
  it('parses DataForSEO dates', () => {
    expect(parseDfsDate('2019-11-15 12:57:46 +00:00')).toBe('2019-11-15T12:57:46.000Z');
    expect(parseDfsDate(null)).toBeNull();
    expect(parseDfsDate('garbage')).toBeNull();
  });

  it('maps the summary on the 0–100 rank scale', async () => {
    const { fn, calls } = fakeFetch(() => ({
      target: 'shop.bg',
      rank: 47,
      backlinks: 1200,
      broken_backlinks: 9,
      referring_domains: 140,
      referring_ips: 120,
      referring_links_attributes: { nofollow: 200, noopener: 10 },
      info: { target_spam_score: 4 },
    }));
    const s = backlinkSummarySchema.parse(
      await provider(fn).getBacklinkSummary('https://www.shop.bg/'),
    );
    expect(calls[0]).toMatchObject({
      path: 'backlinks/summary/live',
      body: { target: 'shop.bg', rank_scale: 'one_hundred', backlinks_status_type: 'live' },
    });
    expect(s).toMatchObject({
      rating: 47,
      dofollow: 1000,
      nofollow: 200,
      referringDomains: 140,
      spamScore: 4,
    });
  });

  it('maps backlinks: rel from dofollow/attributes, dates, lost and status codes', async () => {
    const { fn, calls } = fakeFetch(() => ({
      items: [
        {
          domain_from: 'www.blog.bg',
          url_from: 'https://www.blog.bg/post',
          domain_to: 'shop.bg',
          url_to: 'https://shop.bg/',
          anchor: 'Магазин',
          dofollow: true,
          attributes: null,
          item_type: 'anchor',
          domain_from_rank: 35,
          first_seen: '2024-01-02 10:00:00 +00:00',
          last_seen: '2026-10-01 08:00:00 +00:00',
          is_lost: false,
          url_to_status_code: 200,
          backlink_spam_score: 3,
        },
        {
          domain_from: 'forum.bg',
          url_from: 'https://forum.bg/t/1',
          domain_to: 'shop.bg',
          url_to: 'https://shop.bg/old',
          anchor: null,
          dofollow: false,
          attributes: ['nofollow', 'ugc'],
          item_type: 'image',
          domain_from_rank: 12,
          first_seen: '2023-05-01 00:00:00 +00:00',
          last_seen: '2026-09-01 00:00:00 +00:00',
          is_lost: true,
          url_to_status_code: 404,
          backlink_spam_score: null,
        },
      ],
    }));
    const rows = await provider(fn).getBacklinks('shop.bg', {
      limit: 5000,
      offset: 0,
      status: 'all',
      onePerDomain: true,
    });
    for (const r of rows) backlinkSchema.parse(r);
    expect(calls[0]!.body).toMatchObject({
      target: 'shop.bg',
      mode: 'one_per_domain',
      backlinks_status_type: 'all',
      limit: 1000,
      rank_scale: 'one_hundred',
    });
    expect(calls[0]!.body.filters).toBeUndefined();
    expect(rows[0]).toMatchObject({
      sourceDomain: 'blog.bg',
      rel: 'follow',
      linkType: 'text',
      sourceRating: 35,
      firstSeen: '2024-01-02T10:00:00.000Z',
      lostAt: null,
      spamScore: 3,
    });
    expect(rows[1]).toMatchObject({
      rel: 'ugc',
      linkType: 'image',
      anchor: '',
      lostAt: '2026-09-01T00:00:00.000Z',
      targetStatus: 404,
      spamScore: null,
    });

    const follow = fakeFetch(() => ({ items: [] }));
    await provider(follow.fn).getBacklinks('shop.bg', {
      limit: 10,
      offset: 0,
      status: 'live',
      rel: 'follow',
      onePerDomain: false,
    });
    expect(follow.calls[0]!.body.filters).toEqual(['dofollow', '=', true]);
  });

  it('maps referring domains with lost dates and spam scores', async () => {
    const { fn, calls } = fakeFetch(() => ({
      items: [
        {
          domain: 'blog.bg',
          rank: 40,
          backlinks: 12,
          first_seen: '2024-01-02 10:00:00 +00:00',
          lost_date: null,
          backlinks_spam_score: 2,
          referring_links_attributes: { nofollow: 2 },
        },
        {
          domain: 'gone.bg',
          rank: 5,
          backlinks: 1,
          first_seen: '2022-01-01 00:00:00 +00:00',
          lost_date: '2025-01-01 00:00:00 +00:00',
        },
      ],
    }));
    const rows = await provider(fn).getReferringDomains('shop.bg', { limit: 100, offset: 0 });
    for (const r of rows) referringDomainSchema.parse(r);
    expect(calls[0]).toMatchObject({
      path: 'backlinks/referring_domains/live',
      body: { target: 'shop.bg', backlinks_status_type: 'all', rank_scale: 'one_hundred' },
    });
    expect(rows[0]).toMatchObject({
      domain: 'blog.bg',
      dofollow: 10,
      rating: 40,
      lostAt: null,
      spamScore: 2,
    });
    expect(rows[1]).toMatchObject({
      lostAt: '2025-01-01T00:00:00.000Z',
      lastSeen: '2025-01-01T00:00:00.000Z',
      spamScore: null,
    });
  });
});
