import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { AppError } from '@seo/shared';
import {
  CurrentOrg,
  CurrentUser,
  RequirePermission,
  type AppRequest,
  type AuthUser,
  type OrgContext,
} from '../common/request-context.js';
import { PrivacyService } from './privacy.service.js';

const confirmEmailSchema = z.object({ confirmEmail: z.string().trim().min(3).max(254) });
const confirmNameSchema = z.object({ confirmName: z.string().trim().min(1).max(200) });

/** Personal data operations need the person, not an API key. */
function assertSession(req: AppRequest) {
  if (req.apiKey) throw new AppError('FORBIDDEN', 'Not available with an API key');
}

function sendJson(res: Response, filename: string, data: unknown) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(data, null, 2));
}

@ApiTags('privacy')
@Controller()
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  /** GDPR Art. 15/20: everything we store about the signed-in user. */
  @Get('me/export')
  async exportMe(@CurrentUser() user: AuthUser, @Req() req: AppRequest, @Res() res: Response) {
    assertSession(req);
    sendJson(res, `kompas-seo-account-${user.id}.json`, await this.privacy.exportUser(user.id));
  }

  /** What deleting the account would do (organizations to transfer or delete). */
  @Get('me/deletion-check')
  deletionCheck(@CurrentUser() user: AuthUser, @Req() req: AppRequest) {
    assertSession(req);
    return this.privacy.deletionCheck(user.id);
  }

  /** GDPR Art. 17: deletes the account and organizations where the user is alone. */
  @Post('me/delete')
  @HttpCode(204)
  async deleteMe(
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Body({ schema: confirmEmailSchema }) body: z.output<typeof confirmEmailSchema>,
  ) {
    assertSession(req);
    await this.privacy.deleteUser(user, body.confirmEmail);
  }

  @Get('organization/export')
  @RequirePermission('organization:delete')
  async exportOrganization(
    @CurrentOrg() org: OrgContext,
    @Req() req: AppRequest,
    @Res() res: Response,
  ) {
    assertSession(req);
    sendJson(
      res,
      `kompas-seo-organization-${org.id}.json`,
      await this.privacy.exportOrganization(org.id),
    );
  }

  /** Deletes the organization with all projects, research and history. Owner only. */
  @Post('organization/delete')
  @HttpCode(204)
  @RequirePermission('organization:delete')
  async deleteOrganization(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Body({ schema: confirmNameSchema }) body: z.output<typeof confirmNameSchema>,
  ) {
    assertSession(req);
    await this.privacy.deleteOrganization(
      { organizationId: org.id, userId: user.id },
      body.confirmName,
    );
  }
}
