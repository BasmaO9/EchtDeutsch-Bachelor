import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { MediaService } from './media.service';
import { PersonalizationService } from '../personalization/personalization.service';
import { ApiTags, ApiOperation, ApiBody } from '@nestjs/swagger';

@ApiTags('Media')
@Controller('media')
export class MediaController {
  constructor(
    private readonly mediaService: MediaService,
    private readonly personalizationService: PersonalizationService,
  ) {}

  @ApiOperation({ summary: 'Create new media item' })
  @ApiBody({
    schema: {
      example: {
        title: 'DW News: Klimawandel in Deutschland',
        type: 'video',
        sourceUrl: 'https://dw.com/video1',
        transcript: 'In Deutschland verändert sich das Klima...',
        cefr: 'A2',
        topic: 'news',
      },
    },
  })
  @Post()
  create(@Body() body: any) {
    return this.mediaService.createMedia(body);
  }

  @ApiOperation({ summary: 'Get all media' })
  @Get()
  getAll() {
    return this.mediaService.getAllMedia();
  }

  @ApiOperation({ summary: 'Get one media by ID' })
  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.mediaService.getMediaById(id);
  }

  @ApiOperation({ 
    summary: 'Scrape article or YouTube video',
    description: 'Scrapes content from Nachrichtenleicht, Deutsche Welle, or YouTube (German videos, max 15 minutes). Automatically detects the source and scrapes accordingly.'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        url: { 
          type: 'string', 
          example: 'https://www.nachrichtenleicht.de/...',
          description: 'URL of the article or YouTube video to scrape'
        }
      },
      required: ['url']
    }
  })
  @Post('scrape')
  async scrape(@Body() body: { url: string }) {
    if (!body.url) {
      throw new Error('URL is required');
    }
    return this.mediaService.scrapeAndSaveArticle(body.url);
  }

  @ApiOperation({ summary: 'Generate personalization using real LLM' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        cefr: { type: 'string', example: 'B1', description: 'CEFR level (A1, A2, B1, B2, C1, C2)' },
        interests: { type: 'array', items: { type: 'string' }, example: ['Travel', 'Culture'], description: 'User interests (1-5 items)' },
        studyMajor: { type: 'string', example: 'Computer Science / IT', description: 'Study major (optional)' },
        userId: { type: 'string', example: 'demo-user', description: 'User ID' }
      },
      required: ['cefr', 'interests', 'userId']
    }
  })
  @Post(':id/personalize')
  async personalize(
    @Param('id') id: string,
    @Body() body: { cefr: string; interests: string[]; studyMajor?: string; userId: string }
  ) {
    if (!body.cefr || !body.interests || !body.userId) {
      throw new Error('Missing required fields: cefr, interests, userId');
    }
    return this.personalizationService.createPersonalization(id, {
      cefr: body.cefr,
      interests: body.interests,
      studyMajor: body.studyMajor,
      userId: body.userId,
    });
  }
}
