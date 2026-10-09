import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module.js';
import { KeywordsModule } from '../keywords/keywords.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { RankingsController } from './rankings.controller.js';
import { RankingsService } from './rankings.service.js';

@Module({
  imports: [ProjectsModule, KeywordsModule, JobsModule],
  controllers: [RankingsController],
  providers: [RankingsService],
  exports: [RankingsService],
})
export class RankingsModule {}
