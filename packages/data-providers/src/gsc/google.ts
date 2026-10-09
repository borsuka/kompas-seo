import { AppError } from '@seo/shared';

/**
 * Google OAuth 2.0 (web server flow) and the Search Console API v3.
 * Docs: developers.google.com/identity/protocols/oauth2/web-server and
 * developers.google.com/webmaster-tools/v1 (sites.list, searchanalytics.query).
 */

export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/webmasters/v3';
/** searchAnalytics.query maximum rowLimit. */
export const GSC_MAX_ROWS = 25_000;

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch?: typeof fetch;
}

export interface TokenSet {
  accessToken: string;
  expiresIn: number;
  /** Only on the first consent with access_type=offline (we force prompt=consent). */
  refreshToken: string | null;
  scope: string;
}

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    /** `invalid_grant` = refresh token revoked or expired: the user has to reconnect. */
    readonly code: string,
  ) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

export class GoogleOAuth {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: GoogleOAuthConfig) {
    this.fetchImpl = config.fetch ?? fetch;
  }

  authorizationUrl(state: string, loginHint?: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: GSC_SCOPE,
      access_type: 'offline',
      // Always show consent so Google returns a refresh token, also on reconnect.
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    if (loginHint) params.set('login_hint', loginHint);
    return `${AUTH_URL}?${params.toString()}`;
  }

  private async token(body: Record<string, string>): Promise<TokenSet> {
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        ...body,
      }).toString(),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof json.access_token !== 'string') {
      const code = typeof json.error === 'string' ? json.error : `http_${res.status}`;
      throw new GoogleAuthError(`Google token request failed: ${code}`, code);
    }
    return {
      accessToken: json.access_token,
      expiresIn: typeof json.expires_in === 'number' ? json.expires_in : 3600,
      refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
      scope: typeof json.scope === 'string' ? json.scope : '',
    };
  }

  exchangeCode(code: string) {
    return this.token({
      code,
      redirect_uri: this.config.redirectUri,
      grant_type: 'authorization_code',
    });
  }

  refresh(refreshToken: string) {
    return this.token({ refresh_token: refreshToken, grant_type: 'refresh_token' });
  }

  /** Best effort: revoking also invalidates the refresh token. */
  async revoke(token: string): Promise<void> {
    await this.fetchImpl(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    }).catch(() => undefined);
  }
}

export interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

export interface GscQueryRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscQuery {
  startDate: string;
  endDate: string;
  dimensions: ('date' | 'query' | 'page' | 'country' | 'device')[];
  rowLimit?: number;
  startRow?: number;
}

/** Search Console data source (Google or the mock). */
export interface GscClient {
  readonly name: 'google' | 'mock';
  listSites(accessToken: string): Promise<GscSite[]>;
  query(accessToken: string, siteUrl: string, q: GscQuery): Promise<GscQueryRow[]>;
}

export class GoogleGscClient implements GscClient {
  readonly name = 'google';
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { fetch?: typeof fetch } = {}) {
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private async request<T>(accessToken: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${API}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 || res.status === 403)
      throw new AppError('FORBIDDEN', 'Search Console access was denied', { status: res.status });
    if (res.status === 429) throw new AppError('RATE_LIMITED', 'Search Console quota exceeded');
    if (!res.ok) throw new AppError('PROVIDER_UNAVAILABLE', `Search Console error ${res.status}`);
    return (await res.json()) as T;
  }

  async listSites(accessToken: string): Promise<GscSite[]> {
    const json = await this.request<{ siteEntry?: GscSite[] }>(accessToken, '/sites');
    return json.siteEntry ?? [];
  }

  async query(accessToken: string, siteUrl: string, q: GscQuery): Promise<GscQueryRow[]> {
    const json = await this.request<{ rows?: GscQueryRow[] }>(
      accessToken,
      `/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        startDate: q.startDate,
        endDate: q.endDate,
        dimensions: q.dimensions,
        type: 'web',
        rowLimit: Math.min(GSC_MAX_ROWS, q.rowLimit ?? GSC_MAX_ROWS),
        startRow: q.startRow ?? 0,
      },
    );
    return json.rows ?? [];
  }
}

/** Picks the property that matches a project domain: Domain property first, then URL prefix. */
export function matchSite(sites: readonly GscSite[], domain: string): GscSite | null {
  const usable = sites.filter((s) => s.permissionLevel !== 'siteUnverifiedUser');
  const d = domain.replace(/^www\./, '');
  return (
    usable.find((s) => s.siteUrl === `sc-domain:${d}`) ??
    usable.find((s) => {
      try {
        return new URL(s.siteUrl).hostname.replace(/^www\./, '') === d;
      } catch {
        return false;
      }
    }) ??
    null
  );
}
