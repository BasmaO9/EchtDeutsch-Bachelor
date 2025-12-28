import { Controller, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiResponse } from '@nestjs/swagger';
import { SpacyPosService, SpacyPosResult } from './spacy-pos.service';
import { CefrClassificationService } from './cefr-classification.service';

@ApiTags('Text Analysis')
@Controller('text-analysis')
export class SpacyPosController {
  constructor(
    private readonly spacyPosService: SpacyPosService,
    private readonly cefrClassificationService: CefrClassificationService,
  ) {}

  @ApiOperation({
    summary: 'Extract POS tags from German transcript',
    description:
      'Extracts nouns, verbs, and adjectives from a German transcript using spaCy. Also extracts occurrences (sentences/phrases) for each verb, noun, and adjective. Sentences longer than 20 words are trimmed while preserving the occurrence word.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        transcript: {
          type: 'string',
          description: 'German text transcript to analyze',
          example: 'Der Hund läuft schnell im Park.',
        },
      },
      required: ['transcript'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'POS tags extracted successfully',
    schema: {
      type: 'object',
      properties: {
        nouns: {
          type: 'array',
          items: { type: 'string' },
          example: ['hund', 'park'],
        },
        verbs: {
          type: 'array',
          items: { type: 'string' },
          example: ['laufen'],
        },
        adjectives: {
          type: 'array',
          items: { type: 'string' },
          example: ['schnell'],
        },
        verb_occurrences: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              infinitive: { type: 'string', example: 'laufen' },
              phrase: { type: 'string', example: 'Der Hund läuft schnell im Park.' },
            },
          },
          description: 'List of verb occurrences with their phrases (max 20 words per phrase)',
        },
        noun_occurrences: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              noun: { type: 'string', example: 'hund' },
              phrase: { type: 'string', example: 'Der Hund läuft schnell im Park.' },
            },
          },
          description: 'List of noun occurrences with their phrases (max 20 words per phrase)',
        },
        adjective_occurrences: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              adjective: { type: 'string', example: 'schnell' },
              phrase: { type: 'string', example: 'Der Hund läuft schnell im Park.' },
            },
          },
          description: 'List of adjective occurrences with their phrases (max 20 words per phrase)',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - transcript is empty or invalid',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error - spaCy processing failed',
  })
  @Post('spacy-pos')
  async extractPosTags(
    @Body() body: { transcript: string },
  ): Promise<SpacyPosResult> {
    if (!body.transcript) {
      throw new HttpException(
        'Transcript is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    return await this.spacyPosService.extractPosTags(body.transcript);
  }

  @ApiOperation({
    summary: 'Classify text by CEFR level',
    description:
      'Classifies German text by CEFR level (A1, A2, B1, B2, C1, or C2) using OpenAI',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'German text to classify by CEFR level',
          example: 'Der Hund läuft schnell im Park. Ich mag Hunde sehr gerne.',
        },
      },
      required: ['text'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Text classified successfully',
    schema: {
      type: 'object',
      properties: {
        cefr_level: {
          type: 'string',
          enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
          description: 'The CEFR level of the text',
          example: 'B1',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - text is empty or invalid',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error - OpenAI classification failed',
  })
  @Post('cefr-classify')
  async classifyByCefr(
    @Body() body: { text: string },
  ): Promise<{ cefr_level: string }> {
    if (!body.text) {
      throw new HttpException(
        'Text is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const cefrLevel = await this.cefrClassificationService.classifyText(body.text);
    return { cefr_level: cefrLevel };
  }

  @ApiOperation({
    summary: 'Classify German words by CEFR level',
    description:
      'Classifies an array of German words (nouns, verbs, adjectives) into their CEFR levels (A1, A2, B1, B2, C1, C2) using OpenAI',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        words: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              word: {
                type: 'string',
                description: 'German word to classify',
                example: 'gehen',
              },
              pos: {
                type: 'string',
                enum: ['noun', 'verb', 'adjective'],
                description: 'Part of speech',
                example: 'verb',
              },
            },
            required: ['word', 'pos'],
          },
          description: 'Array of words with their part of speech',
          example: [
            { word: 'gehen', pos: 'verb' },
            { word: 'nachhaltig', pos: 'adjective' },
            { word: 'Haus', pos: 'noun' },
          ],
        },
      },
      required: ['words'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Words classified successfully',
    schema: {
      type: 'object',
      properties: {
        classified: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              word: {
                type: 'string',
                example: 'gehen',
              },
              pos: {
                type: 'string',
                example: 'verb',
              },
              cefr: {
                type: 'string',
                enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
                example: 'A1',
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - words array is empty or invalid',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error - OpenAI classification failed',
  })
  @Post('classify-words')
  async classifyWords(
    @Body() body: { words: Array<{ word: string; pos: 'noun' | 'verb' | 'adjective' }> },
  ): Promise<{ classified: Array<{ word: string; pos: string; cefr: string }> }> {
    if (!body.words || !Array.isArray(body.words) || body.words.length === 0) {
      throw new HttpException(
        'Words array is required and cannot be empty',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate each word has required fields
    const invalidWords = body.words.filter(
      (w) => !w.word || !w.pos || !['noun', 'verb', 'adjective'].includes(w.pos)
    );

    if (invalidWords.length > 0) {
      throw new HttpException(
        `Invalid words format. Each word must have 'word' and 'pos' (noun, verb, or adjective)`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const classified = await this.cefrClassificationService.classifyWords(body.words);
    return { classified };
  }

  @ApiOperation({
    summary: 'Extract POS tags and classify words by CEFR level',
    description:
      'Combines spacy-pos and classify-words endpoints. Extracts nouns, verbs, and adjectives from a German transcript using spaCy, then classifies them by CEFR level. Returns both POS extraction results and CEFR classifications.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        transcript: {
          type: 'string',
          description: 'German text transcript to analyze',
          example: 'Der Hund läuft schnell im Park.',
        },
      },
      required: ['transcript'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'POS tags extracted and words classified successfully',
    schema: {
      type: 'object',
      properties: {
        nouns: {
          type: 'array',
          items: { type: 'string' },
          example: ['hund', 'park'],
        },
        verbs: {
          type: 'array',
          items: { type: 'string' },
          example: ['laufen'],
        },
        adjectives: {
          type: 'array',
          items: { type: 'string' },
          example: ['schnell'],
        },
        verb_occurrences: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              infinitive: { type: 'string', example: 'laufen' },
              phrase: { type: 'string', example: 'Der Hund läuft schnell im Park.' },
            },
          },
        },
        noun_occurrences: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              noun: { type: 'string', example: 'hund' },
              phrase: { type: 'string', example: 'Der Hund läuft schnell im Park.' },
            },
          },
        },
        adjective_occurrences: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              adjective: { type: 'string', example: 'schnell' },
              phrase: { type: 'string', example: 'Der Hund läuft schnell im Park.' },
            },
          },
        },
        classified: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              word: { type: 'string', example: 'gehen' },
              pos: { type: 'string', example: 'verb' },
              cefr: {
                type: 'string',
                enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
                example: 'A1',
              },
            },
          },
          description: 'Array of words with their CEFR classifications',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - transcript is empty or invalid',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error - spaCy processing or CEFR classification failed',
  })
  @Post('analyze-and-classify')
  async analyzeAndClassify(
    @Body() body: { transcript: string },
  ): Promise<SpacyPosResult & { classified: Array<{ word: string; pos: string; cefr: string }> }> {
    if (!body.transcript) {
      throw new HttpException(
        'Transcript is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Step 1: Extract POS tags using spaCy
    const spacyResult = await this.spacyPosService.extractPosTags(body.transcript);

    // Step 2: Reconstruct output for classify-words
    const wordsToClassify: Array<{ word: string; pos: 'noun' | 'verb' | 'adjective' }> = [];

    // Add nouns
    if (spacyResult.nouns && Array.isArray(spacyResult.nouns)) {
      spacyResult.nouns.forEach((noun: string) => {
        wordsToClassify.push({ word: noun, pos: 'noun' });
      });
    }

    // Add verbs
    if (spacyResult.verbs && Array.isArray(spacyResult.verbs)) {
      spacyResult.verbs.forEach((verb: string) => {
        wordsToClassify.push({ word: verb, pos: 'verb' });
      });
    }

    // Add adjectives
    if (spacyResult.adjectives && Array.isArray(spacyResult.adjectives)) {
      spacyResult.adjectives.forEach((adj: string) => {
        wordsToClassify.push({ word: adj, pos: 'adjective' });
      });
    }

    // Step 3: Classify words by CEFR level
    let classified: Array<{ word: string; pos: string; cefr: string }> = [];
    
    if (wordsToClassify.length > 0) {
      classified = await this.cefrClassificationService.classifyWords(wordsToClassify);
    }

    // Step 4: Return combined result
    return {
      ...spacyResult,
      classified,
    };
  }
}

