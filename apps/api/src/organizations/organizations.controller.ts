import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { createOrganizationSchema, inviteMemberSchema, updateMemberRoleSchema } from '@seo/shared';
import {
  CurrentOrg,
  CurrentUser,
  RequirePermission,
  type AppRequest,
  type AuthUser,
  type OrgContext,
} from '../common/request-context.js';
import { OrganizationsService } from './organizations.service.js';

const id = z.string().min(1).max(64);

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(private readonly orgs: OrganizationsService) {}

  /** Everything the app shell needs: user, organizations, active org with plan and credits. */
  @Get()
  me(@CurrentUser() user: AuthUser, @Req() req: AppRequest) {
    return this.orgs.me(user, req.session!);
  }
}

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Body({ schema: createOrganizationSchema }) body: z.output<typeof createOrganizationSchema>,
  ) {
    return this.orgs.create(user, req.headers, body.name);
  }

  @Post(':id/activate')
  @HttpCode(204)
  async activate(
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) orgId: string,
  ) {
    await this.orgs.activate(user, req.headers, orgId);
  }
}

/** Operations on the active organization (resolved by PermissionGuard). */
@ApiTags('organization')
@Controller('organization')
export class ActiveOrganizationController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get('members')
  @RequirePermission('member:read')
  members(@CurrentOrg() org: OrgContext) {
    return this.orgs.members(org.id);
  }

  @Patch('members/:memberId')
  @HttpCode(204)
  @RequirePermission('member:update')
  async updateRole(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('memberId', { schema: id }) memberId: string,
    @Body({ schema: updateMemberRoleSchema }) body: z.output<typeof updateMemberRoleSchema>,
  ) {
    await this.orgs.updateRole(org, user, req.headers, memberId, body.role);
  }

  @Delete('members/:memberId')
  @HttpCode(204)
  @RequirePermission('member:remove')
  async removeMember(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('memberId', { schema: id }) memberId: string,
  ) {
    await this.orgs.removeMember(org, user, req.headers, memberId);
  }

  @Get('invitations')
  @RequirePermission('member:read')
  invitations(@CurrentOrg() org: OrgContext) {
    return this.orgs.invitations(org.id);
  }

  @Post('invitations')
  @RequirePermission('member:invite')
  invite(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Body({ schema: inviteMemberSchema }) body: z.output<typeof inviteMemberSchema>,
  ) {
    return this.orgs.invite(org, user, req.headers, body.email, body.role);
  }

  @Delete('invitations/:invitationId')
  @HttpCode(204)
  @RequirePermission('member:invite')
  async cancel(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('invitationId', { schema: id }) invitationId: string,
  ) {
    await this.orgs.cancelInvitation(org, user, req.headers, invitationId);
  }
}

/** Invitation lookups by the invitee (who is not a member yet). */
@ApiTags('invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get(':id')
  get(@Req() req: AppRequest, @Param('id', { schema: id }) invitationId: string) {
    return this.orgs.getInvitation(req.headers, invitationId);
  }

  @Post(':id/accept')
  accept(
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) invitationId: string,
  ) {
    return this.orgs.acceptInvitation(user, req.headers, invitationId);
  }
}
