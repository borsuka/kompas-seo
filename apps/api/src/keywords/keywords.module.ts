import { Module } from '@nestjs/common';
import { KeywordsController } from './keywords.controller.js';
import { KeywordsService } from './keywords.service.js';

@Module({
  controllers: [KeywordsController],
  providers: [KeywordsService],
  exports: [KeywordsService],
})
export class KeywordsModule {}
