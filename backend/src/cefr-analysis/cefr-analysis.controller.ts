import { Controller, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiResponse } from '@nestjs/swagger';
import { CefrAnalysisService } from './cefr-analysis.service';

@ApiTags('CEFR Analysis')
@Controller('cefr-analysis')
export class CefrAnalysisController {
  constructor(private readonly cefrAnalysisService: CefrAnalysisService) {}

  @ApiOperation({ 
    summary: 'Analyze German text for lexical difficulty based on CEFR levels',
    description: 'Classifies each word in a German text according to the minimum CEFR level (A1-C2) a learner needs to understand that word. Returns percentages and word lists for each level.'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        text: { 
          type: 'string', 
          example: 'Der Hund läuft schnell durch den Park. Die Katze sitzt auf dem Baum.', 
          description: 'German text to analyze for lexical difficulty' 
        },
      },
      required: ['text'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully analyzed the text',
    schema: {
      type: 'object',
      properties: {
        A1: {
          type: 'object',
          properties: {
            percentage: { type: 'number', example: 45.5 },
            words: { type: 'array', items: { type: 'string' }, example: ['der', 'hund', 'laufen'] }
          }
        },
        A2: {
          type: 'object',
          properties: {
            percentage: { type: 'number', example: 25.0 },
            words: { type: 'array', items: { type: 'string' }, example: ['schnell', 'park'] }
          }
        },
        B1: {
          type: 'object',
          properties: {
            percentage: { type: 'number', example: 15.0 },
            words: { type: 'array', items: { type: 'string' }, example: ['baum'] }
          }
        },
        B2: {
          type: 'object',
          properties: {
            percentage: { type: 'number', example: 10.0 },
            words: { type: 'array', items: { type: 'string' }, example: [] }
          }
        },
        C1: {
          type: 'object',
          properties: {
            percentage: { type: 'number', example: 4.5 },
            words: { type: 'array', items: { type: 'string' }, example: [] }
          }
        },
        C2: {
          type: 'object',
          properties: {
            percentage: { type: 'number', example: 0.0 },
            words: { type: 'array', items: { type: 'string' }, example: [] }
          }
        },
        unknown: {
          type: 'array',
          items: { type: 'string' },
          example: []
        }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - text is missing or empty'
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error - failed to analyze text'
  })
  @Post('analyze')
  async analyzeText(@Body() body: { text: string }) {
    try {
      if (!body.text || body.text.trim() === '') {
        throw new HttpException('Text is required and cannot be empty', HttpStatus.BAD_REQUEST);
      }

      const result = await this.cefrAnalysisService.analyzeLexicalDifficulty(body.text.trim());
      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to analyze text: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}

