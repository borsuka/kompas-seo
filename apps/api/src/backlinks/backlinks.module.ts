import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { BacklinksController } from './backlinks.controller.js';
import { BacklinksService } from './backlinks.service.js';

@Module({
  imports: [ProjectsModule],
  controllers: [BacklinksController],
  providers: [BacklinksService],
  exports: [BacklinksService],
})
export class BacklinksModule {}
