import { Module } from '@nestjs/common';
import { CefrAnalysisService } from './cefr-analysis.service';
import { CefrAnalysisController } from './cefr-analysis.controller';

@Module({
  controllers: [CefrAnalysisController],
  providers: [CefrAnalysisService],
  exports: [CefrAnalysisService],
})
export class CefrAnalysisModule {}

