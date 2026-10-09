import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { GscController } from './gsc.controller.js';
import { GscService } from './gsc.service.js';

@Module({
  imports: [ProjectsModule, JobsModule],
  controllers: [GscController],
  providers: [GscService],
  exports: [GscService],
})
export class GscModule {}
