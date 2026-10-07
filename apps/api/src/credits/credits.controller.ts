import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { pageQuerySchema, type PageQuery } from '@seo/shared';
import { CurrentOrg, RequirePermission, type OrgContext } from '../common/request-context.js';
import { CreditsService } from './credits.service.js';

@ApiTags('credits')
@Controller('credits')
export class CreditsController {
  constructor(private readonly credits: CreditsService) {}

  @Get()
  @RequirePermission('credits:read')
  overview(@CurrentOrg() org: OrgContext) {
    return this.credits.overview(org.id);
  }

  @Get('ledger')
  @RequirePermission('credits:read')
  ledger(@CurrentOrg() org: OrgContext, @Query({ schema: pageQuerySchema }) q: PageQuery) {
    return this.credits.ledger(org.id, q.page, q.pageSize);
  }
}
