import { Module } from '@nestjs/common';
import { BacklinksModule } from '../backlinks/backlinks.module.js';
import { DomainsModule } from '../domains/domains.module.js';
import { GscModule } from '../gsc/gsc.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { RankingsModule } from '../rankings/rankings.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [DomainsModule, BacklinksModule, RankingsModule, GscModule, ProjectsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
