import { Module } from '@nestjs/common';
import { PersonalizationService } from './personalization.service';
import { PersonalizationController } from './personalization.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Personalization, PersonalizationSchema } from 'src/Models/personalization.schema';
import { Media, MediaSchema } from 'src/Models/media.schema';
import { Evaluation, EvaluationSchema } from 'src/Models/evaluation.schema';
import { UserProfile, UserProfileSchema } from 'src/Models/user-profile.schema';
import { Progress, ProgressSchema } from 'src/Models/progress.schema';
import { TextAnalysisModule } from '../text-analysis/text-analysis.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Media.name, schema: MediaSchema },
      { name: Personalization.name, schema: PersonalizationSchema },
        { name: Evaluation.name, schema: EvaluationSchema },
        { name: Progress.name, schema: ProgressSchema },
      { name: UserProfile.name, schema: UserProfileSchema },
    ]),
    TextAnalysisModule,
  ],
  controllers: [PersonalizationController],
  providers: [PersonalizationService],
  exports: [PersonalizationService],
})
export class PersonalizationModule {}
