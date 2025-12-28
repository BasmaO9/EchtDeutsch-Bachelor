import { Module } from '@nestjs/common';
import { TextAnalysisService } from './text-analysis.service';
import { TextAnalysisFactoryService } from './text-analysis-factory.service';
import { DaflexAnalyzerService } from './daflex-analyzer.service';
import { SpacyPosService } from './spacy-pos.service';
import { SpacyPosController } from './spacy-pos.controller';
import { CefrClassificationService } from './cefr-classification.service';

/**
 * Module for text analysis functionality
 * Provides CEFR level analysis for German texts and POS tag extraction
 */
@Module({
  controllers: [SpacyPosController],
  providers: [
    TextAnalysisService,
    TextAnalysisFactoryService,
    DaflexAnalyzerService,
    SpacyPosService,
    CefrClassificationService,
  ],
  exports: [TextAnalysisService, SpacyPosService, CefrClassificationService],
})
export class TextAnalysisModule {}

