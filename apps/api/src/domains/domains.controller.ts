import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  contentGapQuerySchema,
  domainKeywordsQuerySchema,
  domainLocaleQuerySchema,
  domainPagesQuerySchema,
  exportQuerySchema,
  keywordGapQuerySchema,
  type ContentGapQuery,
  type DomainKeywordRow,
  type DomainKeywordsQuery,
  type DomainLocaleQuery,
  type KeywordGapQuery,
  type KeywordGapRow,
} from '@seo/shared';
import { KEYWORD_EXPORT_HEADERS, sendExport, type ExportColumn } from '../common/export.js';
import {
  CurrentOrg,
  CurrentUser,
  RequirePermission,
  type AppRequest,
  type AuthUser,
  type OrgContext,
} from '../common/request-context.js';
import type { ResearchContext } from '../keywords/keywords.service.js';
import { DomainsService } from './domains.service.js';

const id = z.string().min(1).max(64);
const ui = z.object({ ui: z.enum(['bg', 'en']).default('bg') });

const POSITION_HEADER = { bg: 'Позиция', en: 'Position' } as const;
const URL_HEADER = { bg: 'URL', en: 'URL' } as const;
const TRAFFIC_HEADER = { bg: 'Трафик', en: 'Traffic' } as const;

@ApiTags('domains')
@Controller()
export class DomainsController {
  constructor(private readonly domains: DomainsService) {}

  private ctx(org: OrgContext, user: AuthUser, req: AppRequest): ResearchContext {
    return {
      organizationId: org.id,
      userId: user.id,
      role: org.role,
      requestId: String(req.id ?? ''),
    };
  }

  /** Domain Overview: traffic & trend, keyword buckets, rating, backlinks, countries, top keywords/pages. */
  @Get('domains/overview')
  @RequirePermission('project:read')
  overview(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Query({ schema: domainLocaleQuerySchema }) q: DomainLocaleQuery,
  ) {
    return this.domains.overview(this.ctx(org, user, req), q);
  }

  /** Organic keywords of a domain (filters, sort, paging, new/lost changes). */
  @Get('domains/keywords')
  @RequirePermission('project:read')
  keywords(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Query({ schema: domainKeywordsQuerySchema }) q: DomainKeywordsQuery,
  ) {
    return this.domains.keywords(this.ctx(org, user, req), q);
  }

  @Get('domains/keywords/export')
  @RequirePermission('project:read')
  async exportKeywords(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Query({ schema: domainKeywordsQuerySchema.extend(exportQuerySchema.shape).extend(ui.shape) })
    q: DomainKeywordsQuery & { format: 'csv' | 'xlsx'; ui: 'bg' | 'en' },
    @Res() res: Response,
  ) {
    const { items } = await this.domains.keywords(this.ctx(org, user, req), {
      ...q,
      page: 1,
      pageSize: 100_000,
    });
    const h = KEYWORD_EXPORT_HEADERS[q.ui];
    const columns: ExportColumn<DomainKeywordRow>[] = [
      { header: h.keyword, value: (r) => r.keyword, width: 40 },
      { header: POSITION_HEADER[q.ui], value: (r) => r.position },
      { header: h.volume, value: (r) => r.volume },
      { header: TRAFFIC_HEADER[q.ui], value: (r) => r.traffic },
      { header: h.kd, value: (r) => r.kd },
      { header: h.cpc, value: (r) => r.cpc },
      { header: h.intent, value: (r) => r.intent.join(', ') },
      { header: URL_HEADER[q.ui], value: (r) => r.url, width: 60 },
    ];
    await sendExport(res, q.format, `${q.domain}-keywords`, columns, items);
  }

  @Get('domains/pages')
  @RequirePermission('project:read')
  pages(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Query({ schema: domainPagesQuerySchema }) q: z.output<typeof domainPagesQuerySchema>,
  ) {
    return this.domains.pages(this.ctx(org, user, req), q);
  }

  /** Automatic competitor discovery for a project (cached for a week). */
  @Get('projects/:id/competitors/discover')
  @RequirePermission('project:read')
  discover(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
  ) {
    return this.domains.discover(this.ctx(org, user, req), projectId);
  }

  /** Keyword gap: up to 5 domains, tabs missing/weak/strong/untapped/unique/shared. */
  @Get('domains/keyword-gap')
  @RequirePermission('project:read')
  keywordGap(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Query({ schema: keywordGapQuerySchema }) q: KeywordGapQuery,
  ) {
    return this.domains.keywordGap(this.ctx(org, user, req), q);
  }

  @Get('domains/keyword-gap/export')
  @RequirePermission('project:read')
  async exportGap(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Query({ schema: keywordGapQuerySchema.extend(exportQuerySchema.shape).extend(ui.shape) })
    q: KeywordGapQuery & { format: 'csv' | 'xlsx'; ui: 'bg' | 'en' },
    @Res() res: Response,
  ) {
    const result = await this.domains.keywordGap(this.ctx(org, user, req), {
      ...q,
      page: 1,
      pageSize: 100_000,
    });
    const h = KEYWORD_EXPORT_HEADERS[q.ui];
    const columns: ExportColumn<KeywordGapRow>[] = [
      { header: h.keyword, value: (r) => r.keyword, width: 40 },
      { header: h.volume, value: (r) => r.volume },
      { header: h.kd, value: (r) => r.kd },
      { header: h.cpc, value: (r) => r.cpc },
      { header: h.intent, value: (r) => r.intent.join(', ') },
      ...result.domains.map((d) => ({
        header: d,
        value: (r: KeywordGapRow) => r.positions[d] ?? null,
      })),
    ];
    await sendExport(res, q.format, `keyword-gap-${q.target}-${q.tab}`, columns, result.items);
  }

  /** Content gap: competitor topics without a matching page on the target. */
  @Get('domains/content-gap')
  @RequirePermission('project:read')
  contentGap(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Query({ schema: contentGapQuerySchema }) q: ContentGapQuery,
  ) {
    return this.domains.contentGap(this.ctx(org, user, req), q);
  }
}
