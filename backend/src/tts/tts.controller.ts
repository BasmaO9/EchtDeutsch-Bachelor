import { Controller, Post, Body, Res, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody } from '@nestjs/swagger';
import type { Response } from 'express';
import { TtsService } from './tts.service';

@ApiTags('TTS')
@Controller('tts')
export class TtsController {
  constructor(private readonly ttsService: TtsService) {}

  @ApiOperation({ summary: 'Generate speech from text using Google Cloud Text-to-Speech API' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string', example: 'der Hund', description: 'Text to convert to speech (German word with article if noun)' },
      },
      required: ['text'],
    },
  })
  @Post('speak')
  async speak(@Body() body: { text: string }, @Res() res: Response) {
    try {
      if (!body.text || body.text.trim() === '') {
        throw new HttpException('Text is required', HttpStatus.BAD_REQUEST);
      }

      const audioBuffer = await this.ttsService.generateSpeech(body.text.trim());

      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Length', audioBuffer.length.toString());
      res.setHeader('Content-Disposition', `inline; filename="speech.wav"`);
      res.send(audioBuffer);
    } catch (error) {
      throw new HttpException(
        'Failed to generate speech: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

