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
import { createBriefSchema } from '@seo/shared';
import {
  CurrentOrg,
  CurrentUser,
  RequirePermission,
  type AppRequest,
  type AuthUser,
  type OrgContext,
} from '../common/request-context.js';
import { ContentService } from './content.service.js';

const id = z.string().min(1).max(64);
const listQuery = z.object({
  projectId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const exportQuery = z.object({ ui: z.enum(['bg', 'en']).default('bg') });

@ApiTags('content')
@Controller('content/briefs')
export class ContentController {
  constructor(private readonly content: ContentService) {}

  /** Starts a brief: SERP top 10 → crawl → analysis → AI outline (background job). */
  @Post()
  @RequirePermission('report:create')
  create(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Body({ schema: createBriefSchema }) body: z.output<typeof createBriefSchema>,
  ) {
    return this.content.create(
      { organizationId: org.id, userId: user.id, role: org.role, requestId: String(req.id ?? '') },
      body,
    );
  }

  @Get()
  @RequirePermission('report:read')
  list(@CurrentOrg() org: OrgContext, @Query({ schema: listQuery }) q: z.output<typeof listQuery>) {
    return this.content.list(org.id, q);
  }

  @Get(':id')
  @RequirePermission('report:read')
  get(@CurrentOrg() org: OrgContext, @Param('id', { schema: id }) briefId: string) {
    return this.content.get(org.id, briefId);
  }

  @Get(':id/export')
  @RequirePermission('report:read')
  async export(
    @CurrentOrg() org: OrgContext,
    @Param('id', { schema: id }) briefId: string,
    @Query({ schema: exportQuery }) q: z.output<typeof exportQuery>,
    @Res() res: Response,
  ) {
    const file = await this.content.markdown(org.id, briefId, q.ui);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    res.send(file.content);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('report:create')
  async remove(@CurrentOrg() org: OrgContext, @Param('id', { schema: id }) briefId: string) {
    await this.content.remove(org.id, briefId);
  }
}
