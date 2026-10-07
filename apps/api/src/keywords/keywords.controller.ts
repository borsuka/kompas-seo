import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  explorerQuerySchema,
  exportQuerySchema,
  overviewQuerySchema,
  type ExplorerQuery,
  type KeywordRow,
  type OverviewQuery,
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
import { KeywordsService, type ResearchContext } from './keywords.service.js';

const uiLangSchema = z.object({ ui: z.enum(['bg', 'en']).default('bg') });

export function keywordExportColumns(ui: 'bg' | 'en'): ExportColumn<KeywordRow>[] {
  const h = KEYWORD_EXPORT_HEADERS[ui];
  return [
    { header: h.keyword, value: (r) => r.keyword, width: 40 },
    { header: h.volume, value: (r) => r.volume },
    { header: h.kd, value: (r) => r.kd },
    { header: h.cpc, value: (r) => r.cpc },
    { header: h.competition, value: (r) => r.competition },
    { header: h.intent, value: (r) => r.intent.join(', '), width: 24 },
    { header: h.features, value: (r) => r.serpFeatures.join(', '), width: 30 },
    { header: h.words, value: (r) => r.wordCount },
    { header: h.source, value: (r) => r.source },
  ];
}

@ApiTags('keywords')
@Controller('keywords')
export class KeywordsController {
  constructor(private readonly keywords: KeywordsService) {}

  private ctx(org: OrgContext, user: AuthUser, req: AppRequest): ResearchContext {
    return {
      organizationId: org.id,
      userId: user.id,
      role: org.role,
      requestId: String(req.id ?? ''),
    };
  }

  /** Keyword Explorer: ideas for a seed with server-side filters, sorting and paging. */
  @Get('explore')
  @RequirePermission('keywordList:read')
  explore(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Query({ schema: explorerQuerySchema }) q: ExplorerQuery,
  ) {
    return this.keywords.explore(this.ctx(org, user, req), q);
  }

  @Get('explore/export')
  @RequirePermission('keywordList:read')
  async exportExplore(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Query({
      schema: explorerQuerySchema.extend(exportQuerySchema.shape).extend(uiLangSchema.shape),
    })
    q: ExplorerQuery & { format: 'csv' | 'xlsx'; ui: 'bg' | 'en' },
    @Res() res: Response,
  ) {
    const { items } = await this.keywords.exploreAll(this.ctx(org, user, req), q);
    await sendExport(res, q.format, `keywords-${q.q}`, keywordExportColumns(q.ui), items);
  }

  /** Keyword Overview: metrics, trend, SERP top 10 with page metrics, KD, parent topic. */
  @Get('overview')
  @RequirePermission('keywordList:read')
  overview(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Query({ schema: overviewQuerySchema }) q: OverviewQuery,
  ) {
    return this.keywords.overview(this.ctx(org, user, req), q);
  }
}
