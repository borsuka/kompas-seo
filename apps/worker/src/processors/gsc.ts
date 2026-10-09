import { GoogleAuthError, GSC_MAX_ROWS, mockAccessToken } from '@seo/data-providers';
import { and, eq, schema } from '@seo/db';
import { insertGscRows, type GscRow } from '@seo/db/clickhouse';
import { decryptSecret } from '@seo/shared/server';
import type { Processor, WorkerDeps } from '../runtime.js';

/** First sync covers this many days; later syncs re-read the last days (data finalizes). */
const INITIAL_DAYS = 90;
const RESYNC_DAYS = 7;
/** Search Console data is typically available after 2–3 days. */
const LAG_DAYS = 2;

export interface GscSyncInput {
  projectId: string;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 86_400_000));

/** AAD binds an encrypted refresh token to its project (cannot be swapped between rows). */
export const gscTokenAad = (projectId: string) => `gsc:${projectId}`;

type Connection = typeof schema.gscConnections.$inferSelect;

/** Access token for a connection (cached in Redis until shortly before it expires). */
export async function gscAccessToken(deps: WorkerDeps, conn: Connection, domain: string) {
  if (conn.provider === 'mock') return mockAccessToken(domain);
  if (!deps.gsc.oauth || !conn.refreshTokenEnc || !deps.encryptionKey)
    throw new Error('Google Search Console is not configured');
  const cacheKey = `gsc:at:${conn.id}`;
  const cached = await deps.redis.get(cacheKey);
  if (cached) return cached;
  const refresh = decryptSecret(
    conn.refreshTokenEnc,
    deps.encryptionKey,
    gscTokenAad(conn.projectId),
  );
  const tokens = await deps.gsc.oauth.refresh(refresh);
  await deps.redis.set(cacheKey, tokens.accessToken, 'EX', Math.max(60, tokens.expiresIn - 120));
  return tokens.accessToken;
}

/** Pulls daily query × page performance into ClickHouse, one day per request (Google's advice). */
export const syncGsc: Processor<GscSyncInput, { days: number; rows: number }> = async (
  input,
  ctx,
) => {
  const { db, clickhouse, gsc } = ctx.deps;
  const orgId = ctx.orgId;
  if (!orgId) throw new Error('gsc.sync requires an organization');
  const [row] = await db
    .select({ conn: schema.gscConnections, domain: schema.projects.domain })
    .from(schema.gscConnections)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.gscConnections.projectId))
    .where(
      and(
        eq(schema.gscConnections.projectId, input.projectId),
        eq(schema.gscConnections.organizationId, orgId),
      ),
    );
  if (!row || row.conn.status !== 'active' || !row.conn.siteUrl) return { days: 0, rows: 0 };
  const { conn, domain } = row;

  const markError = (message: string) =>
    db
      .update(schema.gscConnections)
      .set({ status: 'error', lastError: message })
      .where(eq(schema.gscConnections.id, conn.id));

  let token: string;
  try {
    token = await gscAccessToken(ctx.deps, conn, domain);
  } catch (err) {
    if (err instanceof GoogleAuthError && err.code === 'invalid_grant') {
      // Revoked or expired: the user has to reconnect; retrying cannot help.
      await markError('reconnect_required');
      return { days: 0, rows: 0 };
    }
    throw err;
  }

  const client = conn.provider === 'mock' ? gsc.mock : gsc.google;
  const span = conn.lastSyncAt ? RESYNC_DAYS : INITIAL_DAYS;
  const dates = Array.from({ length: span }, (_, i) => daysAgo(LAG_DAYS + span - 1 - i));
  const syncedAt = new Date();
  let total = 0;
  for (const [i, date] of dates.entries()) {
    const rows: GscRow[] = [];
    for (let startRow = 0; ; startRow += GSC_MAX_ROWS) {
      const page = await client.query(token, conn.siteUrl!, {
        startDate: date,
        endDate: date,
        dimensions: ['date', 'query', 'page'],
        rowLimit: GSC_MAX_ROWS,
        startRow,
      });
      for (const r of page)
        rows.push({
          date: r.keys[0]!,
          query: r.keys[1]!,
          page: r.keys[2]!,
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: r.ctr,
          position: r.position,
        });
      if (page.length < GSC_MAX_ROWS) break;
    }
    await insertGscRows(clickhouse, conn.projectId, rows, syncedAt);
    total += rows.length;
    await ctx.progress(((i + 1) / dates.length) * 100, date);
  }
  await db
    .update(schema.gscConnections)
    .set({ lastSyncAt: syncedAt, lastError: null })
    .where(eq(schema.gscConnections.id, conn.id));
  return { days: dates.length, rows: total };
};

/** Daily: one sync per active connection. */
export const scheduleGsc: Processor<unknown, { enqueued: number }> = async (_input, ctx) => {
  const active = await ctx.deps.db
    .select({
      projectId: schema.gscConnections.projectId,
      organizationId: schema.gscConnections.organizationId,
    })
    .from(schema.gscConnections)
    .where(eq(schema.gscConnections.status, 'active'));
  let enqueued = 0;
  for (const c of active) {
    const id = await ctx.deps.enqueue(
      'gsc.sync',
      { projectId: c.projectId } satisfies GscSyncInput,
      {
        organizationId: c.organizationId,
        dedupeKey: `gsc-sync:${c.projectId}:${isoDay(new Date())}`,
      },
    );
    if (id) enqueued++;
  }
  return { enqueued };
};
