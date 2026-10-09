import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  gscPerformanceQuerySchema,
  gscRangeQuerySchema,
  gscSelectSiteSchema,
  type GscPerformanceQuery,
} from '@seo/shared';
import {
  CurrentOrg,
  CurrentUser,
  RequirePermission,
  type AppRequest,
  type AuthUser,
  type OrgContext,
} from '../common/request-context.js';
import type { ResearchContext } from '../keywords/keywords.service.js';
import { GscService } from './gsc.service.js';

const id = z.string().min(1).max(64);
const callbackQuery = z.object({
  code: z.string().max(2048).optional(),
  state: z.string().max(256).optional(),
  error: z.string().max(256).optional(),
});

@ApiTags('search-console')
@Controller()
export class GscController {
  constructor(private readonly gsc: GscService) {}

  private ctx(org: OrgContext, user: AuthUser, req: AppRequest): ResearchContext {
    return {
      organizationId: org.id,
      userId: user.id,
      role: org.role,
      requestId: String(req.id ?? ''),
    };
  }

  @Get('projects/:id/gsc')
  @RequirePermission('project:read')
  status(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
  ) {
    return this.gsc.status(this.ctx(org, user, req), projectId);
  }

  /** Google: returns the consent URL to open. Mock mode connects immediately. */
  @Post('projects/:id/gsc/connect')
  @HttpCode(200)
  @RequirePermission('project:update')
  connect(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
  ) {
    return this.gsc.connect(this.ctx(org, user, req), projectId);
  }

  /**
   * Google OAuth redirect URI. Needs the user's session (same browser); the single-use
   * state identifies the organization and project, so no org header is involved.
   */
  @Get('integrations/gsc/callback')
  async callback(
    @CurrentUser() user: AuthUser,
    @Query({ schema: callbackQuery }) q: z.output<typeof callbackQuery>,
    @Res() res: Response,
  ) {
    res.redirect(302, await this.gsc.callback(user.id, q));
  }

  @Get('projects/:id/gsc/sites')
  @RequirePermission('project:update')
  sites(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
  ) {
    return this.gsc.sites(this.ctx(org, user, req), projectId);
  }

  @Post('projects/:id/gsc/site')
  @HttpCode(200)
  @RequirePermission('project:update')
  selectSite(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
    @Body({ schema: gscSelectSiteSchema }) body: z.output<typeof gscSelectSiteSchema>,
  ) {
    return this.gsc.selectSite(this.ctx(org, user, req), projectId, body.siteUrl);
  }

  @Post('projects/:id/gsc/sync')
  @RequirePermission('project:update')
  sync(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
  ) {
    return this.gsc.sync(this.ctx(org, user, req), projectId);
  }

  /** Disconnects, revokes the Google token and deletes the imported data. */
  @Delete('projects/:id/gsc')
  @HttpCode(204)
  @RequirePermission('project:update')
  async disconnect(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
  ) {
    await this.gsc.disconnect(this.ctx(org, user, req), projectId);
  }

  @Get('projects/:id/gsc/performance')
  @RequirePermission('project:read')
  performance(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
    @Query({ schema: gscPerformanceQuerySchema }) q: GscPerformanceQuery,
  ) {
    return this.gsc.performance(this.ctx(org, user, req), projectId, q);
  }

  @Get('projects/:id/gsc/cannibalization')
  @RequirePermission('project:read')
  cannibalization(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
    @Query({ schema: gscRangeQuerySchema }) q: z.output<typeof gscRangeQuerySchema>,
  ) {
    return this.gsc.cannibalization(this.ctx(org, user, req), projectId, q.days);
  }

  @Get('projects/:id/gsc/calibration')
  @RequirePermission('project:read')
  calibration(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
    @Query({ schema: gscRangeQuerySchema }) q: z.output<typeof gscRangeQuerySchema>,
  ) {
    return this.gsc.calibration(this.ctx(org, user, req), projectId, q.days);
  }
}
