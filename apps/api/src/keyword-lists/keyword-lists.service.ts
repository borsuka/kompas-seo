import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, schema, sql, type Database } from '@seo/db';
import { getStoredMetrics, latestTopUrls, type ClickHouseClient } from '@seo/db/clickhouse';
import {
  AppError,
  can,
  compareKeywords,
  matchesKeywordFilters,
  wordCount,
  type AddListItemsInput,
  type ClusterJobInput,
  type ClusterSummary,
  type CreateKeywordListInput,
  type Job,
  type KeywordList,
  type KeywordListItem,
  type ListItemsQuery,
  type Locale,
  type Paginated,
} from '@seo/shared';
import type { z } from 'zod';
import type {
  addListItemsSchema,
  createKeywordListSchema,
  updateKeywordListSchema,
} from '@seo/shared';
import { AuditService } from '../audit/audit.service.js';
import { CreditsService } from '../credits/credits.service.js';
import { CLICKHOUSE, DB } from '../infra/tokens.js';
import { JobsService } from '../jobs/jobs.service.js';
import { KeywordsService, type ResearchContext } from '../keywords/keywords.service.js';
import { MeteredProviders } from '../providers/metered-providers.service.js';

export const MAX_LIST_ITEMS = 5000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ListRow = typeof schema.keywordLists.$inferSelect;

const toList = (r: ListRow, itemCount: number): KeywordList => ({
  id: r.id,
  name: r.name,
  description: r.description,
  tags: r.tags,
  locationCode: r.locationCode,
  languageCode: r.languageCode,
  projectId: r.projectId,
  itemCount,
  clusteredAt: r.clusteredAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

@Injectable()
export class KeywordListsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLICKHOUSE) private readonly ch: ClickHouseClient,
    private readonly keywords: KeywordsService,
    private readonly jobs: JobsService,
    private readonly credits: CreditsService,
    private readonly metered: MeteredProviders,
    private readonly audit: AuditService,
  ) {}

  private async row(organizationId: string, id: string): Promise<ListRow> {
    if (!UUID_RE.test(id)) throw new AppError('NOT_FOUND', 'Keyword list not found');
    const [r] = await this.db
      .select()
      .from(schema.keywordLists)
      .where(
        and(eq(schema.keywordLists.id, id), eq(schema.keywordLists.organizationId, organizationId)),
      );
    if (!r) throw new AppError('NOT_FOUND', 'Keyword list not found');
    return r;
  }

  private async countItems(listId: string) {
    const [r] = await this.db
      .select({ n: count() })
      .from(schema.keywordListItems)
      .where(eq(schema.keywordListItems.listId, listId));
    return r?.n ?? 0;
  }

  async list(organizationId: string): Promise<KeywordList[]> {
    const rows = await this.db
      .select({
        list: schema.keywordLists,
        // Fully qualified: an unqualified "id" would bind to the inner table.
        itemCount: sql<number>`(select count(*)::int from keyword_list_items i where i.list_id = "keyword_lists"."id")`,
      })
      .from(schema.keywordLists)
      .where(eq(schema.keywordLists.organizationId, organizationId))
      .orderBy(desc(schema.keywordLists.updatedAt));
    return rows.map((r) => toList(r.list, r.itemCount));
  }

  async get(organizationId: string, id: string): Promise<KeywordList> {
    const r = await this.row(organizationId, id);
    return toList(r, await this.countItems(r.id));
  }

  async create(
    ctx: ResearchContext,
    input: z.output<typeof createKeywordListSchema>,
  ): Promise<KeywordList> {
    if (input.projectId) {
      const [p] = await this.db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(
          and(
            eq(schema.projects.id, input.projectId),
            eq(schema.projects.organizationId, ctx.organizationId),
          ),
        );
      if (!p) throw new AppError('NOT_FOUND', 'Project not found');
    }
    const [r] = await this.db
      .insert(schema.keywordLists)
      .values({
        organizationId: ctx.organizationId,
        projectId: input.projectId ?? null,
        name: input.name,
        description: input.description ?? null,
        tags: input.tags,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
        createdBy: ctx.userId ?? null,
      })
      .returning();
    await this.audit.log({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId ?? null,
      action: 'keyword_list.created',
      targetType: 'keyword_list',
      targetId: r!.id,
    });
    return toList(r!, 0);
  }

  async update(
    organizationId: string,
    id: string,
    input: z.output<typeof updateKeywordListSchema>,
  ) {
    await this.row(organizationId, id);
    const [r] = await this.db
      .update(schema.keywordLists)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.tags !== undefined && { tags: input.tags }),
      })
      .where(
        and(eq(schema.keywordLists.id, id), eq(schema.keywordLists.organizationId, organizationId)),
      )
      .returning();
    return toList(r!, await this.countItems(id));
  }

  async remove(ctx: ResearchContext, id: string) {
    await this.row(ctx.organizationId, id);
    await this.db
      .delete(schema.keywordLists)
      .where(
        and(
          eq(schema.keywordLists.id, id),
          eq(schema.keywordLists.organizationId, ctx.organizationId),
        ),
      );
    await this.audit.log({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId ?? null,
      action: 'keyword_list.deleted',
      targetType: 'keyword_list',
      targetId: id,
    });
  }

  // ------------------------------------------------------------------ items

  /** All items joined with stored metrics (lists are capped, so this stays in memory). */
  private async allItems(list: ListRow): Promise<KeywordListItem[]> {
    const items = await this.db
      .select()
      .from(schema.keywordListItems)
      .where(eq(schema.keywordListItems.listId, list.id))
      .orderBy(asc(schema.keywordListItems.createdAt));
    const loc = { locationCode: list.locationCode, languageCode: list.languageCode } as Locale;
    const metrics = await getStoredMetrics(
      this.ch,
      items.map((i) => i.keyword),
      loc,
      3650,
    );
    return items.map((i) => {
      const m = metrics.get(i.keyword);
      return {
        id: i.id,
        keyword: i.keyword,
        volume: m?.volume ?? 0,
        cpc: m?.cpc ?? null,
        competition: m?.competition ?? null,
        kd: m?.kd ?? null,
        intent: m?.intent ?? [],
        serpFeatures: m?.serpFeatures ?? [],
        wordCount: wordCount(i.keyword),
        trend: (m?.trend ?? []).slice(-12).map((t) => t.volume),
        note: i.note,
        tags: i.tags,
        cluster: i.cluster,
        addedAt: i.createdAt.toISOString(),
      };
    });
  }

  async items(
    organizationId: string,
    listId: string,
    q: ListItemsQuery,
  ): Promise<Paginated<KeywordListItem>> {
    const list = await this.row(organizationId, listId);
    const filtered = (await this.allItems(list))
      .filter((i) => matchesKeywordFilters(i, q))
      .filter((i) => !q.cluster || i.cluster === q.cluster)
      .filter((i) => !q.tag || i.tags.includes(q.tag))
      .sort(compareKeywords(q.sort, q.dir));
    const start = (q.page - 1) * q.pageSize;
    return {
      items: filtered.slice(start, start + q.pageSize),
      page: q.page,
      pageSize: q.pageSize,
      total: filtered.length,
    };
  }

  async exportItems(organizationId: string, listId: string) {
    const list = await this.row(organizationId, listId);
    const items = (await this.allItems(list)).sort(compareKeywords('volume', 'desc'));
    return { list, items };
  }

  /** Adds keywords (dedup per list); metrics missing from storage are fetched once. */
  async addItems(ctx: ResearchContext, listId: string, input: z.output<typeof addListItemsSchema>) {
    const list = await this.row(ctx.organizationId, listId);
    const existing = await this.countItems(list.id);
    const unique = [...new Set(input.keywords)];
    if (existing + unique.length > MAX_LIST_ITEMS) {
      throw new AppError('PLAN_LIMIT_REACHED', `A list can hold up to ${MAX_LIST_ITEMS} keywords`, {
        limit: MAX_LIST_ITEMS,
        resource: 'keyword_list_items',
      });
    }
    const loc = { locationCode: list.locationCode, languageCode: list.languageCode } as Locale;
    const { creditsCharged } = await this.keywords.ensureMetrics(ctx, unique, loc);

    const inserted = await this.db
      .insert(schema.keywordListItems)
      .values(
        unique.map((keyword) => ({
          listId: list.id,
          organizationId: ctx.organizationId,
          keyword,
          tags: input.tags,
          addedBy: ctx.userId ?? null,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: schema.keywordListItems.id });
    await this.db
      .update(schema.keywordLists)
      .set({ updatedAt: new Date() })
      .where(eq(schema.keywordLists.id, list.id));
    return { added: inserted.length, skipped: unique.length - inserted.length, creditsCharged };
  }

  async updateItem(
    organizationId: string,
    listId: string,
    itemId: string,
    input: { note?: string | null; tags?: string[] },
  ) {
    await this.row(organizationId, listId);
    if (!UUID_RE.test(itemId)) throw new AppError('NOT_FOUND', 'Item not found');
    const rows = await this.db
      .update(schema.keywordListItems)
      .set({
        ...(input.note !== undefined && { note: input.note }),
        ...(input.tags !== undefined && { tags: input.tags }),
      })
      .where(
        and(
          eq(schema.keywordListItems.id, itemId),
          eq(schema.keywordListItems.listId, listId),
          eq(schema.keywordListItems.organizationId, organizationId),
        ),
      )
      .returning({ id: schema.keywordListItems.id });
    if (!rows.length) throw new AppError('NOT_FOUND', 'Item not found');
  }

  async removeItems(organizationId: string, listId: string, ids: string[]) {
    await this.row(organizationId, listId);
    const rows = await this.db
      .delete(schema.keywordListItems)
      .where(
        and(
          eq(schema.keywordListItems.listId, listId),
          eq(schema.keywordListItems.organizationId, organizationId),
          inArray(schema.keywordListItems.id, ids),
        ),
      )
      .returning({ id: schema.keywordListItems.id });
    return { removed: rows.length };
  }

  // ------------------------------------------------------------------ clusters

  async clusters(organizationId: string, listId: string): Promise<ClusterSummary[]> {
    const list = await this.row(organizationId, listId);
    const groups = new Map<string, ClusterSummary>();
    for (const i of await this.allItems(list)) {
      if (!i.cluster) continue;
      const g = groups.get(i.cluster) ?? { name: i.cluster, keywords: 0, totalVolume: 0 };
      g.keywords++;
      g.totalVolume += i.volume;
      groups.set(i.cluster, g);
    }
    return [...groups.values()].sort(
      (a, b) => b.totalVolume - a.totalVolume || a.name.localeCompare(b.name),
    );
  }

  /**
   * Starts background clustering. Credits for SERPs that must be fetched are charged
   * now (the worker refunds them if the job finally fails).
   */
  async startClustering(ctx: ResearchContext, listId: string, minSharedUrls: number): Promise<Job> {
    const list = await this.row(ctx.organizationId, listId);
    const items = await this.db
      .select({ keyword: schema.keywordListItems.keyword })
      .from(schema.keywordListItems)
      .where(eq(schema.keywordListItems.listId, list.id));
    if (items.length < 2)
      throw new AppError('VALIDATION_FAILED', 'Add at least two keywords to cluster');

    const loc = { locationCode: list.locationCode, languageCode: list.languageCode } as Locale;
    const stored = await latestTopUrls(
      this.ch,
      items.map((i) => i.keyword),
      loc,
      30,
    );
    const missing = items.filter((i) => !stored.has(i.keyword)).length;
    const cost = this.metered.priceOf('keyword.clusterSerp', missing);
    if (cost > 0 && !can(ctx.role, 'research:run')) {
      throw new AppError('FORBIDDEN', 'Your role cannot run new research (it spends credits)', {
        permission: 'research:run',
      });
    }

    return this.credits.withCharge(
      {
        organizationId: ctx.organizationId,
        userId: ctx.userId ?? null,
        description: 'keyword.clusterSerp',
        refType: 'keyword_list',
        refId: list.id,
      },
      cost,
      () =>
        this.jobs.enqueue<ClusterJobInput>(
          'keywords.cluster',
          { listId: list.id, minSharedUrls, creditsCharged: cost },
          { organizationId: ctx.organizationId, userId: ctx.userId ?? '' },
        ),
    );
  }
}

export type { AddListItemsInput, CreateKeywordListInput };
