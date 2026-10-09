import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AppError, createApiKeySchema } from '@seo/shared';
import {
  CurrentOrg,
  CurrentUser,
  requestIp,
  RequirePermission,
  type AppRequest,
  type AuthUser,
  type OrgContext,
} from '../common/request-context.js';
import { ApiKeysService } from './api-keys.service.js';

/** Managing keys needs a signed-in person: an API key cannot create or revoke keys. */
function assertSession(req: AppRequest) {
  if (req.apiKey) throw new AppError('FORBIDDEN', 'API keys cannot manage API keys');
}

@ApiTags('api-keys')
@Controller('organization/api-keys')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  @RequirePermission('apiKey:read')
  list(@CurrentOrg() org: OrgContext, @Req() req: AppRequest) {
    assertSession(req);
    return this.keys.list(org.id);
  }

  /** Returns the key once; only its hash is stored. */
  @Post()
  @RequirePermission('apiKey:manage')
  create(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Body({ schema: createApiKeySchema }) body: z.output<typeof createApiKeySchema>,
  ) {
    assertSession(req);
    return this.keys.create(
      { organizationId: org.id, userId: user.id, role: org.role, ip: requestIp(req) },
      body,
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('apiKey:manage')
  async revoke(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: z.string().min(1).max(64) }) keyId: string,
  ) {
    assertSession(req);
    await this.keys.revoke({ organizationId: org.id, userId: user.id, ip: requestIp(req) }, keyId);
  }
}
