import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  addDisavowSchema,
  anchorsQuerySchema,
  backlinksListQuerySchema,
  backlinkTargetQuerySchema,
  exportQuerySchema,
  linkGapQuerySchema,
  referringDomainsQuerySchema,
  removeDisavowSchema,
  toxicQuerySchema,
  type AnchorsQuery,
  type Backlink,
  type BacklinksListQuery,
  type LinkGapQuery,
  type LinkGapRowDto,
  type ReferringDomain,
  type ReferringDomainsQuery,
  type ToxicQuery,
} from '@seo/shared';
import { sendExport, type ExportColumn } from '../common/export.js';
import {
  CurrentOrg,
  CurrentUser,
  RequirePermission,
  type AppRequest,
  type AuthUser,
  type OrgContext,
} from '../common/request-context.js';
import type { ResearchContext } from '../keywords/keywords.service.js';
import { BacklinksService } from './backlinks.service.js';

const id = z.string().min(1).max(64);
const ui = z.object({ ui: z.enum(['bg', 'en']).default('bg') });
type Ui = 'bg' | 'en';
type ExportQ = { format: 'csv' | 'xlsx'; ui: Ui };

const H = {
  bg: {
    source: 'Източник',
    target: 'Целева страница',
    anchor: 'Анкор',
    rel: 'Атрибут',
    rating: 'Рейтинг',
    spam: 'Спам',
    firstSeen: 'Открит',
    lastSeen: 'Последно видян',
    lost: 'Изгубен',
    domain: 'Домейн',
    backlinks: 'Беклинкове',
    dofollow: 'Dofollow',
    competitors: 'Конкуренти',
  },
  en: {
    source: 'Source',
    target: 'Target page',
    anchor: 'Anchor',
    rel: 'Rel',
    rating: 'Rating',
    spam: 'Spam',
    firstSeen: 'First seen',
    lastSeen: 'Last seen',
    lost: 'Lost',
    domain: 'Domain',
    backlinks: 'Backlinks',
    dofollow: 'Dofollow',
    competitors: 'Competitors',
  },
} as const;

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

@ApiTags('backlinks')
@Controller()
export class BacklinksController {
  constructor(private readonly backlinks: BacklinksService) {}

  private ctx(org: OrgContext, user: AuthUser, req: AppRequest): ResearchContext {
    return {
      organizationId: org.id,
      userId: user.id,
      role: org.role,
      requestId: String(req.id ?? ''),
    };
  }

  /** Profile summary, new/lost referring domains per month, anchors, rel, TLDs. */
  @Get('backlinks/overview')
  @RequirePermission('project:read')
  overview(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Query({ schema: backlinkTargetQuerySchema }) q: { target: string },
  ) {
    return this.backlinks.overview(this.ctx(org, user, req), q.target);
  }

  @Get('backlinks/list')
  @RequirePermission('project:read')
  list(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Query({ schema: backlinksListQuerySchema }) q: BacklinksListQuery,
  ) {
    return this.backlinks.backlinks(this.ctx(org, user, req), q);
  }

  @Get('backlinks/list/export')
  @RequirePermission('project:read')
  async exportList(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Query({ schema: backlinksListQuerySchema.extend(exportQuerySchema.shape).extend(ui.shape) })
    q: BacklinksListQuery & ExportQ,
    @Res() res: Response,
  ) {
    const { items } = await this.backlinks.backlinks(this.ctx(org, user, req), {
      ...q,
      page: 1,
      pageSize: 100_000,
    });
    const h = H[q.ui];
    const columns: ExportColumn<Backlink>[] = [
      { header: h.source, value: (r) => r.sourceUrl, width: 60 },
      { header: h.target, value: (r) => r.targetUrl, width: 50 },
      { header: h.anchor, value: (r) => r.anchor, width: 30 },
      { header: h.rel, value: (r) => r.rel },
      { header: h.rating, value: (r) => r.sourceRating },
      { header: h.spam, value: (r) => r.spamScore },
      { header: h.firstSeen, value: (r) => day(r.firstSeen) },
      { header: h.lastSeen, value: (r) => day(r.lastSeen) },
      { header: h.lost, value: (r) => day(r.lostAt) },
    ];
    await sendExport(res, q.format, `${q.target}-backlinks`, columns, items);
  }

  @Get('backlinks/referring-domains')
  @RequirePermission('project:read')
  referringDomains(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Query({ schema: referringDomainsQuerySchema }) q: ReferringDomainsQuery,
  ) {
    return this.backlinks.referringDomains(this.ctx(org, user, req), q);
  }

  @Get('backlinks/referring-domains/export')
  @RequirePermission('project:read')
  async exportDomains(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Query({ schema: referringDomainsQuerySchema.extend(exportQuerySchema.shape).extend(ui.shape) })
    q: ReferringDomainsQuery & ExportQ,
    @Res() res: Response,
  ) {
    const { items } = await this.backlinks.referringDomains(this.ctx(org, user, req), {
      ...q,
      page: 1,
      pageSize: 100_000,
    });
    const h = H[q.ui];
    const columns: ExportColumn<ReferringDomain>[] = [
      { header: h.domain, value: (r) => r.domain, width: 40 },
      { header: h.rating, value: (r) => r.rating },
      { header: h.backlinks, value: (r) => r.backlinks },
      { header: h.dofollow, value: (r) => r.dofollow },
      { header: h.spam, value: (r) => r.spamScore },
      { header: h.firstSeen, value: (r) => day(r.firstSeen) },
      { header: h.lost, value: (r) => day(r.lostAt) },
    ];
    await sendExport(res, q.format, `${q.target}-referring-domains`, columns, items);
  }

  @Get('backlinks/anchors')
  @RequirePermission('project:read')
  anchors(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Query({ schema: anchorsQuerySchema }) q: AnchorsQuery,
  ) {
    return this.backlinks.anchors(this.ctx(org, user, req), q);
  }

  /** Domains linking to competitors but not to the target. */
  @Get('backlinks/link-gap')
  @RequirePermission('project:read')
  linkGap(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Query({ schema: linkGapQuerySchema }) q: LinkGapQuery,
  ) {
    return this.backlinks.linkGap(this.ctx(org, user, req), q);
  }

  @Get('backlinks/link-gap/export')
  @RequirePermission('project:read')
  async exportGap(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Query({ schema: linkGapQuerySchema.extend(exportQuerySchema.shape).extend(ui.shape) })
    q: LinkGapQuery & ExportQ,
    @Res() res: Response,
  ) {
    const result = await this.backlinks.linkGap(this.ctx(org, user, req), {
      ...q,
      page: 1,
      pageSize: 100_000,
    });
    const h = H[q.ui];
    const columns: ExportColumn<LinkGapRowDto>[] = [
      { header: h.domain, value: (r) => r.domain, width: 40 },
      { header: h.rating, value: (r) => r.rating },
      { header: h.competitors, value: (r) => r.competitors },
      ...result.domains.map((d) => ({ header: d, value: (r: LinkGapRowDto) => r.links[d] ?? 0 })),
    ];
    await sendExport(res, q.format, `link-gap-${q.target}`, columns, result.items);
  }

  /** Toxicity of the project's referring domains (with disavow status). */
  @Get('projects/:id/backlinks/toxic')
  @RequirePermission('project:read')
  toxic(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
    @Query({ schema: toxicQuerySchema }) q: ToxicQuery,
  ) {
    return this.backlinks.toxic(this.ctx(org, user, req), projectId, q);
  }

  @Get('projects/:id/disavow')
  @RequirePermission('project:read')
  disavow(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
  ) {
    return this.backlinks.disavowList(this.ctx(org, user, req), projectId);
  }

  @Post('projects/:id/disavow')
  @RequirePermission('project:update')
  addDisavow(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
    @Body({ schema: addDisavowSchema }) body: z.output<typeof addDisavowSchema>,
  ) {
    return this.backlinks.addDisavow(this.ctx(org, user, req), projectId, body);
  }

  @Post('projects/:id/disavow/remove')
  @HttpCode(200)
  @RequirePermission('project:update')
  removeDisavow(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
    @Body({ schema: removeDisavowSchema }) body: z.output<typeof removeDisavowSchema>,
  ) {
    return this.backlinks.removeDisavow(this.ctx(org, user, req), projectId, body.ids);
  }

  /** disavow.txt for Google Search Console. */
  @Get('projects/:id/disavow/export')
  @RequirePermission('project:read')
  async exportDisavow(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
    @Res() res: Response,
  ) {
    const file = await this.backlinks.disavowExport(this.ctx(org, user, req), projectId);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.filename)}"`,
    );
    res.send(file.content);
  }
}
