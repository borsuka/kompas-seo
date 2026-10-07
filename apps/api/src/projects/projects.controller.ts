import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Body, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { addCompetitorSchema, createProjectSchema, updateProjectSchema } from '@seo/shared';
import {
  CurrentOrg,
  CurrentUser,
  requestIp,
  RequirePermission,
  type AppRequest,
  type AuthUser,
  type OrgContext,
} from '../common/request-context.js';
import { ProjectsService } from './projects.service.js';

const id = z.string().min(1).max(64);

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  private actor(org: OrgContext, user: AuthUser, req: AppRequest) {
    return { organizationId: org.id, userId: user.id, ip: requestIp(req) };
  }

  @Get()
  @RequirePermission('project:read')
  list(@CurrentOrg() org: OrgContext) {
    return this.projects.list(org.id);
  }

  @Post()
  @RequirePermission('project:create')
  create(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Body({ schema: createProjectSchema }) body: z.output<typeof createProjectSchema>,
  ) {
    return this.projects.create(this.actor(org, user, req), body);
  }

  @Get(':id')
  @RequirePermission('project:read')
  get(@CurrentOrg() org: OrgContext, @Param('id', { schema: id }) projectId: string) {
    return this.projects.get(org.id, projectId);
  }

  @Patch(':id')
  @RequirePermission('project:update')
  update(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
    @Body({ schema: updateProjectSchema }) body: z.output<typeof updateProjectSchema>,
  ) {
    return this.projects.update(this.actor(org, user, req), projectId, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('project:delete')
  async remove(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
  ) {
    await this.projects.remove(this.actor(org, user, req), projectId);
  }

  @Get(':id/competitors')
  @RequirePermission('project:read')
  competitors(@CurrentOrg() org: OrgContext, @Param('id', { schema: id }) projectId: string) {
    return this.projects.competitors(org.id, projectId);
  }

  @Post(':id/competitors')
  @RequirePermission('project:update')
  addCompetitor(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
    @Body({ schema: addCompetitorSchema }) body: z.output<typeof addCompetitorSchema>,
  ) {
    return this.projects.addCompetitor(this.actor(org, user, req), projectId, body.domain);
  }

  @Delete(':id/competitors/:competitorId')
  @HttpCode(204)
  @RequirePermission('project:update')
  async removeCompetitor(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Param('id', { schema: id }) projectId: string,
    @Param('competitorId', { schema: id }) competitorId: string,
  ) {
    await this.projects.removeCompetitor(this.actor(org, user, req), projectId, competitorId);
  }
}
