import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  addTrackedKeywordsSchema,
  createRankAlertSchema,
  keywordHistoryQuerySchema,
  rankingsQuerySchema,
  rankingsSummaryQuerySchema,
  removeTrackedKeywordsSchema,
  updateRankAlertSchema,
  updateTrackedKeywordSchema,
  type RankingsQuery,
  type RankingsSummaryQuery,
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
import { RankingsService } from './rankings.service.js';

const id = z.string().min(1).max(64);

@ApiTags('rankings')
@Controller('projects/:id/rankings')
export class RankingsController {
  constructor(private readonly rankings: RankingsService) {}

  private ctx(org: OrgContext, user: AuthUser, req: AppRequest): ResearchContext {
    return {
      organizationId: org.id,
      userId: user.id,
      role: org.role,
      requestId: String(req.id ?? ''),
    };
  }

  /** Tracked keywords with current position, changes, best, URL and competitor positions. */
  @Get()
  @RequirePermission('rankTracking:read')
  list(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
    @Query({ schema: rankingsQuerySchema }) q: RankingsQuery,
  ) {
    return this.rankings.list(this.ctx(org, user, req), projectId, q);
  }

  /** Visibility, average position, distribution, volatility, share of voice and movers. */
  @Get('summary')
  @RequirePermission('rankTracking:read')
  summary(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
    @Query({ schema: rankingsSummaryQuerySchema }) q: RankingsSummaryQuery,
  ) {
    return this.rankings.summary(this.ctx(org, user, req), projectId, q);
  }

  /** Adds keywords (per device) and starts their first check. */
  @Post('keywords')
  @RequirePermission('rankTracking:update')
  add(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
    @Body({ schema: addTrackedKeywordsSchema }) body: z.output<typeof addTrackedKeywordsSchema>,
  ) {
    return this.rankings.add(this.ctx(org, user, req), projectId, body);
  }

  @Post('keywords/remove')
  @HttpCode(200)
  @RequirePermission('rankTracking:update')
  remove(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
    @Body({ schema: removeTrackedKeywordsSchema })
    body: z.output<typeof removeTrackedKeywordsSchema>,
  ) {
    return this.rankings.remove(this.ctx(org, user, req), projectId, body.ids);
  }

  @Patch('keywords/:keywordId')
  @HttpCode(204)
  @RequirePermission('rankTracking:update')
  async updateTags(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
    @Param('keywordId', { schema: id }) keywordId: string,
    @Body({ schema: updateTrackedKeywordSchema }) body: z.output<typeof updateTrackedKeywordSchema>,
  ) {
    await this.rankings.updateTags(this.ctx(org, user, req), projectId, keywordId, body.tags);
  }

  @Get('keywords/:keywordId/history')
  @RequirePermission('rankTracking:read')
  history(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
    @Param('keywordId', { schema: id }) keywordId: string,
    @Query({ schema: keywordHistoryQuerySchema }) q: z.output<typeof keywordHistoryQuerySchema>,
  ) {
    return this.rankings.history(this.ctx(org, user, req), projectId, keywordId, q.days);
  }

  /** Manual re-check of every tracked keyword (background job, charged up front). */
  @Post('check')
  @RequirePermission('rankTracking:update')
  check(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
  ) {
    return this.rankings.check(this.ctx(org, user, req), projectId);
  }

  @Get('alerts')
  @RequirePermission('rankTracking:read')
  alerts(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
  ) {
    return this.rankings.alerts(this.ctx(org, user, req), projectId);
  }

  @Post('alerts')
  @RequirePermission('rankTracking:update')
  createAlert(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
    @Body({ schema: createRankAlertSchema }) body: z.output<typeof createRankAlertSchema>,
  ) {
    return this.rankings.createAlert(this.ctx(org, user, req), projectId, body);
  }

  @Patch('alerts/:alertId')
  @RequirePermission('rankTracking:update')
  updateAlert(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
    @Param('alertId', { schema: id }) alertId: string,
    @Body({ schema: updateRankAlertSchema }) body: z.output<typeof updateRankAlertSchema>,
  ) {
    return this.rankings.updateAlert(this.ctx(org, user, req), projectId, alertId, body);
  }

  @Delete('alerts/:alertId')
  @HttpCode(204)
  @RequirePermission('rankTracking:update')
  async deleteAlert(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
    @Param('alertId', { schema: id }) alertId: string,
  ) {
    await this.rankings.deleteAlert(this.ctx(org, user, req), projectId, alertId);
  }

  @Get('alert-events')
  @RequirePermission('rankTracking:read')
  alertEvents(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
  ) {
    return this.rankings.alertEvents(this.ctx(org, user, req), projectId);
  }
}
