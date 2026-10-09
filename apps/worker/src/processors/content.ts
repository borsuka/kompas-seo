import { withProviderContext } from '@seo/data-providers';
import { and, applyCreditEntry, eq, schema } from '@seo/db';
import { getStoredMetrics, insertSerpSnapshot, latestSerp } from '@seo/db/clickhouse';
import { analyzeTopPages, templateBrief, type AnalyzedPage } from '@seo/seo-core';
import type {
  AnalyzedPageSummary,
  BriefJobInput,
  ContentBrief,
  Locale,
  SerpSnapshot,
} from '@seo/shared';
import type { Processor } from '../runtime.js';

/** Stored SERPs younger than this are reused for briefs. */
const SERP_MAX_AGE_HOURS = 7 * 24;
const PAGES = 10;
const CONCURRENCY = 4;

export interface BriefJobResult {
  pagesAnalyzed: number;
  source: 'ai' | 'template';
}

/**
 * Content brief: SERP top 10 → crawl the ranking pages (robots.txt + SSRF safe) →
 * analysis → outline by Claude (or the deterministic template). Charged up front by the
 * API (`content.brief`) and refunded if the job finally fails.
 */
export const buildBrief: Processor<BriefJobInput, BriefJobResult> = async (input, ctx) => {
  const { db, clickhouse, providers, crawler, llm } = ctx.deps;
  const orgId = ctx.orgId;
  if (!orgId) throw new Error('content.brief requires an organization');
  const where = and(
    eq(schema.contentBriefs.id, input.briefId),
    eq(schema.contentBriefs.organizationId, orgId),
  );

  try {
    const [brief] = await db.select().from(schema.contentBriefs).where(where);
    if (!brief) throw new Error('Brief not found');
    await db.update(schema.contentBriefs).set({ status: 'running', error: null }).where(where);
    const loc: Locale = {
      locationCode: brief.locationCode,
      languageCode: brief.languageCode as Locale['languageCode'],
    };

    // 1) SERP top 10 (stored for a week, otherwise fetched; covered by the brief's price).
    let serp: SerpSnapshot | null = await latestSerp(
      clickhouse,
      brief.keyword,
      loc,
      'desktop',
      SERP_MAX_AGE_HOURS,
    );
    if (!serp || serp.depth < PAGES) {
      serp = await withProviderContext({ orgId }, () =>
        providers.serp.getSerp(brief.keyword, loc, 'desktop', PAGES),
      );
      await insertSerpSnapshot(clickhouse, serp);
    }
    await ctx.progress(15, 'serp');
    const organic = serp.items
      .filter((i) => i.type === 'organic' && i.url && i.rankGroup <= PAGES)
      .map((i) => ({ url: i.url!, position: i.rankGroup }));
    const peopleAlsoAsk = serp.items
      .filter((i) => i.type === 'people_also_ask')
      .flatMap((i) => (i.extra?.questions as string[] | undefined) ?? []);

    // 2) Crawl the ranking pages.
    const analyzed: AnalyzedPage[] = [];
    const summaries: AnalyzedPageSummary[] = [];
    let next = 0;
    let done = 0;
    const work = async () => {
      while (next < organic.length) {
        const o = organic[next++]!;
        const res = await crawler.crawl(o.url, {
          keyword: brief.keyword,
          language: brief.languageCode,
        });
        if (res.ok && !res.page.noindex) {
          analyzed.push({
            url: o.url,
            position: o.position,
            title: res.page.title,
            metaDescription: res.page.metaDescription,
            h1: res.page.h1,
            headings: res.page.headings,
            text: res.page.text,
            wordCount: res.page.wordCount,
            images: res.page.images.total,
            schemaTypes: res.page.schemaTypes,
          });
          summaries.push({
            url: o.url,
            position: o.position,
            title: res.page.title,
            wordCount: res.page.wordCount,
            h1: res.page.h1[0] ?? null,
            skipped: null,
          });
        } else {
          summaries.push({
            url: o.url,
            position: o.position,
            title: null,
            wordCount: 0,
            h1: null,
            skipped: res.ok ? 'noindex' : res.reason,
          });
        }
        done++;
        await ctx.progress(
          15 + (done / Math.max(1, organic.length)) * 60,
          `pages ${done}/${organic.length}`,
        );
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, organic.length) }, work));
    analyzed.sort((a, b) => a.position - b.position);
    summaries.sort((a, b) => a.position - b.position);

    // 3) Analysis + brief.
    const analysis = analyzeTopPages(analyzed, brief.keyword);
    const metrics = await getStoredMetrics(clickhouse, [brief.keyword], loc, 365);
    const intent = metrics.get(brief.keyword)?.intent[0] ?? null;
    await ctx.progress(80, 'brief');

    let content: ContentBrief | null = null;
    if (llm.enabled && analyzed.length) {
      try {
        content = await llm.generateBrief({
          keyword: brief.keyword,
          language: brief.languageCode,
          intent,
          analysis,
          questions: peopleAlsoAsk,
          competitors: analyzed.map((p) => ({
            position: p.position,
            title: p.title,
            h1: p.h1[0] ?? null,
          })),
        });
      } catch (err) {
        // The template below still gives the writer a usable brief.
        ctx.logger.warn({ err, briefId: brief.id }, 'AI brief failed, using the template');
      }
    }
    const source = content ? 'ai' : 'template';
    content ??= templateBrief(brief.keyword, analysis, {
      language: brief.languageCode,
      intent: intent ?? undefined,
      questions: peopleAlsoAsk,
    });

    await db
      .update(schema.contentBriefs)
      .set({
        status: 'ready',
        source,
        analysis,
        pages: summaries,
        peopleAlsoAsk,
        brief: content,
        error: null,
      })
      .where(where);
    return { pagesAnalyzed: analyzed.length, source };
  } catch (err) {
    if (ctx.isFinalAttempt) {
      await db
        .update(schema.contentBriefs)
        .set({ status: 'failed', error: err instanceof Error ? err.message : String(err) })
        .where(where);
      if (input.creditsCharged > 0)
        await applyCreditEntry(db, {
          organizationId: orgId,
          delta: input.creditsCharged,
          reason: 'refund',
          description: 'Refund: content brief failed',
          refType: 'content_brief',
          refId: input.briefId,
          idempotencyKey: `refund:brief:${input.briefId}`,
        });
    }
    throw err;
  }
};
