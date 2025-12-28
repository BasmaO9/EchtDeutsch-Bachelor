import { Injectable, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class TtsService {
  private readonly apiKey: string;
  private readonly apiUrl = 'https://texttospeech.googleapis.com/v1/text:synthesize';

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_CLOUD_API_KEY || '';
    
    if (!this.apiKey) {
      throw new InternalServerErrorException(
        'Google Cloud API key is not configured. Please set GEMINI_API_KEY or GOOGLE_CLOUD_API_KEY environment variable.'
      );
    }
  }

  async generateSpeech(text: string): Promise<Buffer> {
    if (!this.apiKey) {
      throw new InternalServerErrorException(
        'Google Cloud API key is not configured. Please set GEMINI_API_KEY or GOOGLE_CLOUD_API_KEY environment variable.'
      );
    }

    try {
      // Request configuration for German standard voice
      const requestBody = {
        input: { text: text },
        voice: {
          languageCode: 'de-DE',
          name: 'de-DE-Standard-A', // German standard female voice
          ssmlGender: 'FEMALE',
        },
        audioConfig: {
          audioEncoding: 'LINEAR16', // WAV format (PCM)
          sampleRateHertz: 24000,
        },
      };

      const response = await axios.post(
        `${this.apiUrl}?key=${this.apiKey}`,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.data || !response.data.audioContent) {
        throw new InternalServerErrorException('No audio content received from TTS service');
      }

      // The API returns base64-encoded audio in the audioContent field
      const audioBuffer = Buffer.from(response.data.audioContent, 'base64');
      return audioBuffer;
    } catch (error: any) {
      console.error('TTS Error:', error);
      
      if (error.response) {
        // API error response
        const errorMessage = error.response.data?.error?.message || error.message || 'Unknown error';
        throw new InternalServerErrorException(`Error generating speech: ${errorMessage}`);
      }
      
      const errorMessage = error?.message || 'Unknown error';
      throw new InternalServerErrorException(`Error generating speech: ${errorMessage}`);
    }
  }
}
