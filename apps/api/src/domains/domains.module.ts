import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { DomainsController } from './domains.controller.js';
import { DomainsService } from './domains.service.js';

@Module({
  imports: [ProjectsModule],
  controllers: [DomainsController],
  providers: [DomainsService],
})
export class DomainsModule {}
