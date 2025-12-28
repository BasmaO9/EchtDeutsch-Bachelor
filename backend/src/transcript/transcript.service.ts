import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class TranscriptService {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('TRANSCRIPT_KEY') || '';
    this.baseUrl = this.configService.get<string>('TRANSCRIPT_API_URL') || 'https://transcriptapi.com/api/v2';

    if (!this.apiKey) {
      console.warn('TRANSCRIPT_KEY environment variable is not set. YouTube transcript fetching will not work.');
    }
  }

  async getTranscript(
    videoUrl: string,
    options?: {
      format?: 'json' | 'text';
      includeTimestamp?: boolean;
      sendMetadata?: boolean;
    },
  ) {
    if (!this.apiKey) {
      throw new HttpException(
        'Transcript API key is not configured. Please set TRANSCRIPT_KEY in your environment variables.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const { format = 'json', includeTimestamp = true, sendMetadata = true } = options || {};

    try {
      const params = new URLSearchParams({
        video_url: videoUrl,
        format,
        include_timestamp: String(includeTimestamp),
        send_metadata: String(sendMetadata),
      });

      const response = await axios.get(`${this.baseUrl}/youtube/transcript?${params}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      return response.data;
    } catch (error: any) {
      if (error.response) {
        const status = error.response.status;
        const detail = error.response.data?.detail || error.message;

        if (status === 402) {
          throw new HttpException(
            { message: 'Insufficient credits', detail },
            HttpStatus.PAYMENT_REQUIRED,
          );
        }
        if (status === 429) {
          throw new HttpException(
            { message: 'Rate limit exceeded', detail },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        throw new HttpException({ message: 'API Error', detail }, status);
      }
      throw new HttpException('Unknown error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}


