import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module.js';
import { KeywordsModule } from '../keywords/keywords.module.js';
import { KeywordListsController } from './keyword-lists.controller.js';
import { KeywordListsService } from './keyword-lists.service.js';

@Module({
  imports: [KeywordsModule, JobsModule],
  controllers: [KeywordListsController],
  providers: [KeywordListsService],
})
export class KeywordListsModule {}
