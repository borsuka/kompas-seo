import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { ContentController } from './content.controller.js';
import { ContentService } from './content.service.js';

@Module({
  imports: [ProjectsModule, JobsModule],
  controllers: [ContentController],
  providers: [ContentService],
})
export class ContentModule {}
