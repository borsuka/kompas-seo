import { Body, Controller, Get, Param, Post, Sse } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { createDemoJobSchema } from '@seo/shared';
import {
  CurrentOrg,
  CurrentUser,
  RequirePermission,
  type AuthUser,
  type OrgContext,
} from '../common/request-context.js';
import { JobsService } from './jobs.service.js';

const id = z.string().min(1).max(64);

@ApiTags('jobs')
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  /** Demo job that reports progress step by step (verifies the async pipeline end to end). */
  @Post('demo')
  @RequirePermission('job:create')
  demo(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Body({ schema: createDemoJobSchema }) body: z.output<typeof createDemoJobSchema>,
  ) {
    return this.jobs.enqueue('system.demo-progress', body, {
      organizationId: org.id,
      userId: user.id,
    });
  }

  @Get(':id')
  @RequirePermission('job:read')
  get(@CurrentOrg() org: OrgContext, @Param('id', { schema: id }) jobId: string) {
    return this.jobs.get(org.id, jobId);
  }

  /** Server-Sent Events: `data` is a JobEvent; the stream ends when the job finishes. */
  @Sse(':id/events')
  @RequirePermission('job:read')
  events(@CurrentOrg() org: OrgContext, @Param('id', { schema: id }) jobId: string) {
    return this.jobs.stream(org.id, jobId);
  }
}
