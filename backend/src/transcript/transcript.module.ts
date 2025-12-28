import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TranscriptService } from './transcript.service';

@Module({
  imports: [ConfigModule],
  providers: [TranscriptService],
  exports: [TranscriptService],
})
export class TranscriptModule {}


