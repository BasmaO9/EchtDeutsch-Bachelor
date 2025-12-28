import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { Media, MediaSchema } from 'src/Models/media.schema';
import { Personalization, PersonalizationSchema } from 'src/Models/personalization.schema';
import { PersonalizationModule } from '../personalization/personalization.module';
import { ScraperModule } from '../scraper/scraper.module';
import { TextAnalysisModule } from '../text-analysis/text-analysis.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Media.name, schema: MediaSchema },
      { name: Personalization.name, schema: PersonalizationSchema },
    ]),
    PersonalizationModule,
    ScraperModule,
    TextAnalysisModule,
  ],
  controllers: [MediaController],
  providers: [MediaService],
})
export class MediaModule {}
