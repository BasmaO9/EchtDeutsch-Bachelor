import { Module } from '@nestjs/common';
import { ScraperService } from './scraper.service';
import { PersonalizationModule } from '../personalization/personalization.module';
import { TranscriptModule } from '../transcript/transcript.module';

@Module({
  imports: [PersonalizationModule, TranscriptModule],
  providers: [ScraperService],
  exports: [ScraperService],
})
export class ScraperModule {}

