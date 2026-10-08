import { withProviderContext } from '@seo/data-providers';
import { and, applyCreditEntry, eq, schema, sql } from '@seo/db';
import { getStoredMetrics, insertSerpSnapshot, latestTopUrls } from '@seo/db/clickhouse';
import { clusterKeywords } from '@seo/seo-core';
import type { ClusterJobInput, Locale } from '@seo/shared';
import type { Processor } from '../runtime.js';

/** Stored SERPs younger than this are reused for clustering (rankings move slowly). */
const SERP_MAX_AGE_DAYS = 30;
const CONCURRENCY = 8;

export interface ClusterJobResult {
  keywords: number;
  clusters: number;
  serpsFetched: number;
}

/**
 * Groups a keyword list by SERP overlap (≥ N shared top-10 URLs). Missing SERPs are
 * fetched through the provider layer (credits were charged up front by the API and
 * are refunded if the job finally fails).
 */
export const clusterList: Processor<ClusterJobInput, ClusterJobResult> = async (input, ctx) => {
  const { db, clickhouse, providers } = ctx.deps;
  const orgId = ctx.orgId;
  if (!orgId) throw new Error('keywords.cluster requires an organization');

  try {
    const [list] = await db
      .select()
      .from(schema.keywordLists)
      .where(
        and(
          eq(schema.keywordLists.id, input.listId),
          eq(schema.keywordLists.organizationId, orgId),
        ),
      );
    if (!list) throw new Error('Keyword list not found');
    const loc: Locale = {
      locationCode: list.locationCode,
      languageCode: list.languageCode as Locale['languageCode'],
    };

    const items = await db
      .select({ id: schema.keywordListItems.id, keyword: schema.keywordListItems.keyword })
      .from(schema.keywordListItems)
      .where(eq(schema.keywordListItems.listId, list.id));
    const keywords = items.map((i) => i.keyword);
    await ctx.progress(2, 'loading');

    // 1) SERP top 10 for every keyword (stored first, then fetched with limited concurrency).
    const topUrls = await latestTopUrls(clickhouse, keywords, loc, SERP_MAX_AGE_DAYS);
    const missing = keywords.filter((k) => !topUrls.has(k));
    let done = 0;
    let next = 0;
    const worker = async () => {
      while (next < missing.length) {
        const keyword = missing[next++]!;
        try {
          const snap = await withProviderContext({ orgId }, () =>
            providers.serp.getSerp(keyword, loc, 'desktop', 10),
          );
          await insertSerpSnapshot(clickhouse, snap);
          topUrls.set(
            keyword,
            snap.items
              .filter((i) => i.type === 'organic' && i.url && i.rankGroup <= 10)
              .map((i) => i.url!),
          );
        } catch (err) {
          // One failing keyword falls back to lexical/embedding grouping instead of failing the job.
          ctx.logger.warn({ err, keyword }, 'SERP fetch failed during clustering');
        }
        done++;
        if (done % 10 === 0 || done === missing.length) {
          await ctx.progress(
            2 + (done / Math.max(1, missing.length)) * 78,
            `serp ${done}/${missing.length}`,
          );
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, missing.length) }, worker));

    // 2) Cluster (volumes decide the cluster name).
    const metrics = await getStoredMetrics(clickhouse, keywords, loc, 365);
    const clusters = clusterKeywords(
      keywords.map((k) => ({
        keyword: k,
        volume: metrics.get(k)?.volume ?? 0,
        topUrls: topUrls.get(k),
      })),
      {
        minSharedUrls: input.minSharedUrls,
        onProgress: (p) => void ctx.progress(80 + p * 15, 'clustering'),
      },
    );

    // 3) Persist the assignment.
    const clusterOf = new Map<string, string>();
    for (const c of clusters) for (const k of c.keywords) clusterOf.set(k, c.name);
    await db.transaction(async (tx) => {
      const pairs = items.map((i) => ({
        id: i.id,
        cluster: clusterOf.get(i.keyword) ?? i.keyword,
      }));
      for (let i = 0; i < pairs.length; i += 500) {
        const chunk = pairs.slice(i, i + 500);
        await tx.execute(sql`
          update keyword_list_items as k set cluster = v.cluster
          from (select unnest(${sql.param(chunk.map((p) => p.id))}::uuid[]) as id,
                       unnest(${sql.param(chunk.map((p) => p.cluster))}::text[]) as cluster) as v
          where k.id = v.id and k.organization_id = ${orgId}`);
      }
      await tx
        .update(schema.keywordLists)
        .set({ clusteredAt: new Date() })
        .where(
          and(eq(schema.keywordLists.id, list.id), eq(schema.keywordLists.organizationId, orgId)),
        );
    });

    return { keywords: keywords.length, clusters: clusters.length, serpsFetched: missing.length };
  } catch (err) {
    if (ctx.isFinalAttempt && input.creditsCharged > 0) {
      await applyCreditEntry(db, {
        organizationId: orgId,
        delta: input.creditsCharged,
        reason: 'refund',
        description: 'Refund: keyword clustering failed',
        refType: 'job',
        idempotencyKey: `refund:cluster:${input.listId}:${ctx.attempt}`,
      });
    }
    throw err;
  }
};
