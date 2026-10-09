import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, schema, type Database } from '@seo/db';
import {
  AppError,
  can,
  type Brief,
  type BriefJobInput,
  type BriefListItem,
  type ContentAnalysisDto,
  type ContentBrief,
  type AnalyzedPageSummary,
  type Paginated,
} from '@seo/shared';
import type { z } from 'zod';
import type { createBriefSchema } from '@seo/shared';
import { CreditsService } from '../credits/credits.service.js';
import { DB } from '../infra/tokens.js';
import { JobsService } from '../jobs/jobs.service.js';
import type { ResearchContext } from '../keywords/keywords.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { MeteredProviders } from '../providers/metered-providers.service.js';

type BriefRow = typeof schema.contentBriefs.$inferSelect;

function toBrief(r: BriefRow): Brief {
  return {
    id: r.id,
    keyword: r.keyword,
    locationCode: r.locationCode,
    languageCode: r.languageCode,
    projectId: r.projectId,
    status: r.status,
    source: (r.source as Brief['source']) ?? null,
    jobId: r.jobId,
    analysis: (r.analysis as ContentAnalysisDto | null) ?? null,
    pages: (r.pages as AnalyzedPageSummary[]) ?? [],
    peopleAlsoAsk: (r.peopleAlsoAsk as string[]) ?? [],
    brief: (r.brief as ContentBrief | null) ?? null,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

const MD = {
  bg: {
    brief: 'Бриф за съдържание',
    titles: 'Предложения за заглавие (title)',
    meta: 'Мета описание',
    intent: 'Намерение',
    length: 'Препоръчителна дължина',
    words: 'думи',
    outline: 'Структура',
    terms: 'Ключови термини',
    questions: 'Въпроси, на които да отговорите',
    notes: 'Бележки',
    competitors: 'Анализирани страници (топ 10)',
  },
  en: {
    brief: 'Content brief',
    titles: 'Title tag options',
    meta: 'Meta description',
    intent: 'Search intent',
    length: 'Recommended length',
    words: 'words',
    outline: 'Outline',
    terms: 'Key terms',
    questions: 'Questions to answer',
    notes: 'Notes',
    competitors: 'Analyzed pages (top 10)',
  },
} as const;

@Injectable()
export class ContentService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly projects: ProjectsService,
    private readonly credits: CreditsService,
    private readonly jobs: JobsService,
    private readonly metered: MeteredProviders,
  ) {}

  private async row(organizationId: string, id: string): Promise<BriefRow> {
    const [row] = /^[0-9a-f-]{36}$/i.test(id)
      ? await this.db
          .select()
          .from(schema.contentBriefs)
          .where(
            and(
              eq(schema.contentBriefs.id, id),
              eq(schema.contentBriefs.organizationId, organizationId),
            ),
          )
      : [];
    if (!row) throw new AppError('NOT_FOUND', 'Brief not found');
    return row;
  }

  /** Creates a brief and starts the background job (charged up front, refunded on failure). */
  async create(ctx: ResearchContext, input: z.output<typeof createBriefSchema>): Promise<Brief> {
    if (!can(ctx.role, 'research:run'))
      throw new AppError('FORBIDDEN', 'Your role cannot run new research (it spends credits)', {
        permission: 'research:run',
      });
    if (input.projectId) await this.projects.get(ctx.organizationId, input.projectId);
    const cost = this.metered.priceOf('content.brief', 1);
    const [row] = await this.db
      .insert(schema.contentBriefs)
      .values({
        organizationId: ctx.organizationId,
        projectId: input.projectId ?? null,
        keyword: input.keyword,
        locationCode: input.loc,
        languageCode: input.lang,
        createdBy: ctx.userId ?? null,
      })
      .returning();
    try {
      const job = await this.credits.withCharge(
        {
          organizationId: ctx.organizationId,
          userId: ctx.userId ?? null,
          description: 'content.brief',
          refType: 'content_brief',
          refId: row!.id,
        },
        cost,
        () =>
          this.jobs.enqueue<BriefJobInput>(
            'content.brief',
            { briefId: row!.id, creditsCharged: cost },
            { organizationId: ctx.organizationId, userId: ctx.userId ?? '' },
          ),
      );
      const [updated] = await this.db
        .update(schema.contentBriefs)
        .set({ jobId: job.id })
        .where(eq(schema.contentBriefs.id, row!.id))
        .returning();
      return toBrief(updated!);
    } catch (err) {
      // Not enough credits (or the queue is down): no orphan brief.
      await this.db.delete(schema.contentBriefs).where(eq(schema.contentBriefs.id, row!.id));
      throw err;
    }
  }

  async list(
    organizationId: string,
    q: { projectId?: string; page: number; pageSize: number },
  ): Promise<Paginated<BriefListItem>> {
    const where = and(
      eq(schema.contentBriefs.organizationId, organizationId),
      q.projectId ? eq(schema.contentBriefs.projectId, q.projectId) : undefined,
    );
    const rows = await this.db
      .select()
      .from(schema.contentBriefs)
      .where(where)
      .orderBy(desc(schema.contentBriefs.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const [total] = await this.db.select({ n: count() }).from(schema.contentBriefs).where(where);
    return {
      items: rows.map((r) => {
        const b = toBrief(r);
        return {
          id: b.id,
          keyword: b.keyword,
          locationCode: b.locationCode,
          languageCode: b.languageCode,
          projectId: b.projectId,
          status: b.status,
          source: b.source,
          createdAt: b.createdAt,
        };
      }),
      page: q.page,
      pageSize: q.pageSize,
      total: Number(total?.n ?? 0),
    };
  }

  async get(organizationId: string, id: string): Promise<Brief> {
    return toBrief(await this.row(organizationId, id));
  }

  async remove(organizationId: string, id: string) {
    const row = await this.row(organizationId, id);
    await this.db.delete(schema.contentBriefs).where(eq(schema.contentBriefs.id, row.id));
  }

  /** Markdown version of a ready brief (for docs, CMS or e-mail). */
  async markdown(organizationId: string, id: string, ui: 'bg' | 'en') {
    const b = toBrief(await this.row(organizationId, id));
    if (!b.brief) throw new AppError('CONFLICT', 'The brief is not ready yet');
    const t = MD[ui];
    const c = b.brief;
    const lines = [
      `# ${t.brief}: ${b.keyword}`,
      '',
      `**H1:** ${c.h1}`,
      `**${t.intent}:** ${c.searchIntent}`,
      `**${t.length}:** ${c.wordCount.min}–${c.wordCount.max} ${t.words}`,
      '',
      `## ${t.titles}`,
      ...c.titleOptions.map((x) => `- ${x}`),
      '',
      `## ${t.meta}`,
      c.metaDescription,
      '',
      `## ${t.outline}`,
      ...c.outline.flatMap((o) => [
        `${o.level === 2 ? '###' : '####'} ${o.heading}`,
        ...o.points.map((p) => `- ${p}`),
        '',
      ]),
      `## ${t.terms}`,
      c.keyTerms.join(', '),
      '',
      ...(c.questions.length ? [`## ${t.questions}`, ...c.questions.map((q) => `- ${q}`), ''] : []),
      ...(c.notes.length ? [`## ${t.notes}`, ...c.notes.map((n) => `- ${n}`), ''] : []),
      `## ${t.competitors}`,
      ...b.pages
        .filter((p) => !p.skipped)
        .map((p) => `${p.position}. ${p.title ?? p.url} — ${p.url}`),
      '',
    ];
    return { filename: `brief-${b.keyword.replace(/\s+/g, '-')}.md`, content: lines.join('\n') };
  }
}
