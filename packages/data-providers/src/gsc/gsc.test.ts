import { describe, expect, it, vi } from 'vitest';
import { GoogleAuthError, GoogleGscClient, GoogleOAuth, GSC_SCOPE, matchSite } from './google.js';
import { MockGscClient, mockAccessToken } from './mock.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('GoogleOAuth', () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = new URLSearchParams(String(init?.body));
    if (body.get('grant_type') === 'authorization_code')
      return json({
        access_token: 'at',
        expires_in: 3599,
        refresh_token: 'rt',
        scope: GSC_SCOPE,
        token_type: 'Bearer',
      });
    if (body.get('refresh_token') === 'revoked') return json({ error: 'invalid_grant' }, 400);
    return json({ access_token: 'at2', expires_in: 3599, scope: GSC_SCOPE, token_type: 'Bearer' });
  });
  const oauth = new GoogleOAuth({
    clientId: 'cid',
    clientSecret: 'secret',
    redirectUri: 'https://app.example/api/v1/integrations/gsc/callback',
    fetch: fetchImpl as unknown as typeof fetch,
  });

  it('builds an offline consent URL with state', () => {
    const url = new URL(oauth.authorizationUrl('state-123', 'me@example.bg'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'cid',
      response_type: 'code',
      scope: GSC_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state: 'state-123',
      login_hint: 'me@example.bg',
    });
  });

  it('exchanges codes, refreshes tokens and reports invalid_grant', async () => {
    expect(await oauth.exchangeCode('code-1')).toEqual({
      accessToken: 'at',
      expiresIn: 3599,
      refreshToken: 'rt',
      scope: GSC_SCOPE,
    });
    const sent = new URLSearchParams(String(calls[0]!.init!.body));
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/token');
    expect(Object.fromEntries(sent)).toMatchObject({
      code: 'code-1',
      grant_type: 'authorization_code',
      client_secret: 'secret',
    });
    expect((await oauth.refresh('rt')).refreshToken).toBeNull();
    await expect(oauth.refresh('revoked')).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(oauth.refresh('revoked')).rejects.toBeInstanceOf(GoogleAuthError);
  });
});

describe('GoogleGscClient', () => {
  it('lists sites and queries search analytics with an encoded property', async () => {
    const urls: string[] = [];
    const bodies: unknown[] = [];
    const client = new GoogleGscClient({
      fetch: (async (url: string, init?: RequestInit) => {
        urls.push(url);
        if (init?.body) bodies.push(JSON.parse(String(init.body)));
        return url.endsWith('/sites')
          ? json({ siteEntry: [{ siteUrl: 'sc-domain:shop.bg', permissionLevel: 'siteOwner' }] })
          : json({
              rows: [
                {
                  keys: ['2026-10-01', 'обувки'],
                  clicks: 3,
                  impressions: 40,
                  ctr: 0.075,
                  position: 4.2,
                },
              ],
            });
      }) as unknown as typeof fetch,
    });
    expect(await client.listSites('t')).toHaveLength(1);
    const rows = await client.query('t', 'sc-domain:shop.bg', {
      startDate: '2026-10-01',
      endDate: '2026-10-01',
      dimensions: ['date', 'query'],
      rowLimit: 100_000,
    });
    expect(rows[0]!.keys).toEqual(['2026-10-01', 'обувки']);
    expect(urls[1]).toBe(
      'https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Ashop.bg/searchAnalytics/query',
    );
    expect(bodies[0]).toMatchObject({
      rowLimit: 25_000,
      startRow: 0,
      type: 'web',
      dimensions: ['date', 'query'],
    });
  });

  it('matches the project domain to a property', () => {
    const sites = [
      { siteUrl: 'https://www.shop.bg/', permissionLevel: 'siteFullUser' },
      { siteUrl: 'sc-domain:shop.bg', permissionLevel: 'siteOwner' },
      { siteUrl: 'sc-domain:other.bg', permissionLevel: 'siteOwner' },
    ];
    expect(matchSite(sites, 'shop.bg')!.siteUrl).toBe('sc-domain:shop.bg');
    expect(matchSite(sites.slice(0, 1), 'shop.bg')!.siteUrl).toBe('https://www.shop.bg/');
    expect(
      matchSite(
        [{ siteUrl: 'sc-domain:shop.bg', permissionLevel: 'siteUnverifiedUser' }],
        'shop.bg',
      ),
    ).toBeNull();
  });
});

describe('MockGscClient', () => {
  it('returns deterministic daily rows with some queries split across pages', async () => {
    const client = new MockGscClient();
    const token = mockAccessToken('seo-pro.bg');
    expect((await client.listSites(token))[0]!.siteUrl).toBe('sc-domain:seo-pro.bg');
    const q = {
      startDate: '2026-10-01',
      endDate: '2026-10-03',
      dimensions: ['date', 'query', 'page'] as ('date' | 'query' | 'page')[],
    };
    const rows = await client.query(token, 'sc-domain:seo-pro.bg', q);
    expect(rows.length).toBeGreaterThan(10);
    expect(new Set(rows.map((r) => r.keys[0]))).toEqual(
      new Set(['2026-10-01', '2026-10-02', '2026-10-03']),
    );
    expect(rows.every((r) => r.clicks <= r.impressions)).toBe(true);
    const pagesPerQuery = new Map<string, Set<string>>();
    for (const r of rows)
      pagesPerQuery.set(r.keys[1]!, (pagesPerQuery.get(r.keys[1]!) ?? new Set()).add(r.keys[2]!));
    expect([...pagesPerQuery.values()].some((s) => s.size > 1)).toBe(true);
    expect(await client.query(token, 'sc-domain:seo-pro.bg', q)).toEqual(rows);
    const page2 = await client.query(token, 'x', { ...q, startRow: 5, rowLimit: 5 });
    expect(page2).toEqual(rows.slice(5, 10));
  });
});
