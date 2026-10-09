import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { domainLocaleQuerySchema } from '@seo/shared';
import {
  CurrentOrg,
  CurrentUser,
  RequirePermission,
  type AppRequest,
  type AuthUser,
  type OrgContext,
} from '../common/request-context.js';
import { ReportsService } from './reports.service.js';

const reportQuery = domainLocaleQuerySchema.extend({
  projectId: z.uuid().optional(),
  ui: z.enum(['bg', 'en']).default('bg'),
});

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** PDF: organic visibility, backlinks and (with a project) rankings and Search Console. */
  @Get('domain.pdf')
  @RequirePermission('report:read')
  async domain(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Query({ schema: reportQuery }) q: z.output<typeof reportQuery>,
    @Res() res: Response,
  ) {
    const { filename, pdf } = await this.reports.domainReport(
      { organizationId: org.id, userId: user.id, role: org.role, requestId: String(req.id ?? '') },
      q,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  }
}
