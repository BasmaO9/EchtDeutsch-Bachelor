import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MediaModule } from './media/media.module';
import { PersonalizationModule } from './personalization/personalization.module';
import { UserProfileModule } from './user-profile/user-profile.module';
import { TtsModule } from './tts/tts.module';
import { CefrAnalysisModule } from './cefr-analysis/cefr-analysis.module';
import { AuthModule } from './auth/auth.module';
import { ResultsModule } from './results/results.module';
import { ReportsModule } from './reports/reports.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // 👇 use ConfigService to safely load the env variable
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'), // safe access
      }),
    }),
    AuthModule,
    MediaModule,
    PersonalizationModule,
    UserProfileModule,
    TtsModule,
    CefrAnalysisModule,
    ResultsModule,
    ReportsModule,
  ],
})
export class AppModule {}
